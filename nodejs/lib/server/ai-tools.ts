// Multi-provider chat engine on the Vercel AI SDK v6.
//
// Web search backend is controlled by MAGPIE_SEARCH_BACKEND:
//   - native: use the provider's first-party search where available
//     (Anthropic web_search, Google grounding, Perplexity built-in).
//     Providers without native search get no search.
//   - tavily: always Tavily (requires TAVILY_API_KEY). Uniform across
//     providers but adds a third-party hop and per-search cost.
//   - auto (default): prefer native when the active provider has it,
//     fall back to Tavily otherwise.

import { streamText, generateText, tool, jsonSchema, stepCountIs } from 'ai'
import type { ModelMessage, LanguageModel } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google as googleDefault, createGoogleGenerativeAI } from '@ai-sdk/google'
import { groq } from '@ai-sdk/groq'
import { mistral } from '@ai-sdk/mistral'
import { cohere } from '@ai-sdk/cohere'
import { perplexity } from '@ai-sdk/perplexity'
import { bedrock } from '@ai-sdk/amazon-bedrock'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import { tavilySearch, type SearchResult } from './web-search'
import { getToolsForServers, executeMcpToolCall, isMcpToolName } from './mcp'

// ─── Model registry ──────────────────────────────────────────────────────────
//
// Sensible default model set per provider. Used by:
//   - the /api/providers endpoint to expose models to the UI
//   - the /api/chat endpoint to validate the requested model
//
// AI21 was dropped from token.js's coverage in the migration — they don't
// expose an OpenAI-compatible endpoint and don't have a first-party AI SDK
// provider package. Re-add via @ai-sdk/openai-compatible if AI21 ever
// publishes an OpenAI-shaped surface.

export interface ModelInfo {
  id: string
  label: string
}

export type ProviderCategory = 'cloud' | 'local'

// Factory: given a model id, return an AI SDK LanguageModel. Captures any
// per-provider construction needs (local providers need a baseURL up front).
type ModelFactory = (modelId: string) => LanguageModel

export interface ProviderInfo {
  id: string
  label: string
  category: ProviderCategory
  envKey?: string                  // cloud: env var that must be set
  baseURLEnv?: string              // local: env var that overrides baseURL
  defaultBaseURL?: string          // local: fallback baseURL
  defaultModel: string
  models: ModelInfo[]
  createModel: ModelFactory
}

// Lazy local-provider model factories — created on first use so envKey
// changes between requests get picked up.
function localFactory(name: string, envKey: string, fallback: string): ModelFactory {
  return (modelId: string) => {
    const baseURL = process.env[envKey] || fallback
    const compat = createOpenAICompatible({ name, baseURL, apiKey: 'local' })
    return compat(modelId)
  }
}

export const PROVIDERS: ProviderInfo[] = [
  // ── cloud ──
  {
    id: 'anthropic', label: 'Anthropic', category: 'cloud', envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
    createModel: (m) => anthropic(m),
  },
  {
    id: 'openai', label: 'OpenAI', category: 'cloud', envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o',      label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'o1-preview',  label: 'o1 preview' },
      { id: 'o1-mini',     label: 'o1 mini' },
    ],
    createModel: (m) => openai(m),
  },
  {
    id: 'gemini', label: 'Google Gemini', category: 'cloud', envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash-Lite' },
    ],
    // @ai-sdk/google's default singleton reads GOOGLE_GENERATIVE_AI_API_KEY,
    // but the Magpie env convention (and most users' existing setups) uses
    // GEMINI_API_KEY. Build the provider explicitly with that key at request
    // time so an env change between requests gets picked up. Fall back to
    // the default singleton if only the SDK-native var is set.
    createModel: (m) => {
      const key = process.env.GEMINI_API_KEY
      if (!key) return googleDefault(m)
      return createGoogleGenerativeAI({ apiKey: key })(m)
    },
  },
  {
    id: 'groq', label: 'Groq', category: 'cloud', envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B Instant' },
      { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8×7B' },
    ],
    createModel: (m) => groq(m),
  },
  {
    id: 'mistral', label: 'Mistral', category: 'cloud', envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest',     label: 'Codestral' },
    ],
    createModel: (m) => mistral(m),
  },
  {
    id: 'cohere', label: 'Cohere', category: 'cloud', envKey: 'COHERE_API_KEY',
    defaultModel: 'command-r-plus',
    models: [
      { id: 'command-r-plus', label: 'Command R+' },
      { id: 'command-r',      label: 'Command R' },
      { id: 'command',        label: 'Command' },
    ],
    createModel: (m) => cohere(m),
  },
  {
    id: 'perplexity', label: 'Perplexity', category: 'cloud', envKey: 'PERPLEXITY_API_KEY',
    defaultModel: 'sonar',
    models: [
      { id: 'sonar',     label: 'Sonar' },
      { id: 'sonar-pro', label: 'Sonar Pro' },
    ],
    createModel: (m) => perplexity(m),
  },
  {
    id: 'bedrock', label: 'AWS Bedrock', category: 'cloud', envKey: 'AWS_ACCESS_KEY_ID',
    defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    models: [
      { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Bedrock Claude 3.5 Sonnet' },
      { id: 'meta.llama3-1-70b-instruct-v1:0',           label: 'Bedrock Llama 3.1 70B' },
    ],
    createModel: (m) => bedrock(m),
  },
  // ── local (OpenAI-compatible) ──
  {
    id: 'ollama', label: 'Ollama', category: 'local',
    baseURLEnv: 'OLLAMA_BASE_URL', defaultBaseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1:8b',
    models: [
      { id: 'llama3.1:8b',  label: 'Llama 3.1 8B' },
      { id: 'llama3.2:3b',  label: 'Llama 3.2 3B' },
      { id: 'qwen2.5:7b',   label: 'Qwen 2.5 7B' },
      { id: 'qwen2.5:14b',  label: 'Qwen 2.5 14B' },
      { id: 'mistral:7b',   label: 'Mistral 7B' },
      { id: 'gemma2:9b',    label: 'Gemma 2 9B' },
      { id: 'phi3:14b',     label: 'Phi 3 14B' },
    ],
    createModel: localFactory('ollama', 'OLLAMA_BASE_URL', 'http://localhost:11434/v1'),
  },
  {
    id: 'llamacpp', label: 'llama.cpp', category: 'local',
    baseURLEnv: 'LLAMACPP_BASE_URL', defaultBaseURL: 'http://localhost:8080/v1',
    defaultModel: 'loaded-model',
    models: [
      { id: 'loaded-model', label: 'Currently loaded model' },
    ],
    createModel: localFactory('llamacpp', 'LLAMACPP_BASE_URL', 'http://localhost:8080/v1'),
  },
  {
    id: 'lmstudio', label: 'LM Studio', category: 'local',
    baseURLEnv: 'LMSTUDIO_BASE_URL', defaultBaseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: [
      { id: 'local-model',                 label: 'Currently loaded model' },
      { id: 'llama-3.2-3b-instruct',       label: 'Llama 3.2 3B Instruct' },
      { id: 'qwen2.5-7b-instruct',         label: 'Qwen 2.5 7B Instruct' },
      { id: 'mistral-7b-instruct-v0.3',    label: 'Mistral 7B Instruct v0.3' },
    ],
    createModel: localFactory('lmstudio', 'LMSTUDIO_BASE_URL', 'http://localhost:1234/v1'),
  },
]

export function findProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find(p => p.id === id)
}

export interface PublicProviderInfo {
  id: string
  label: string
  category: ProviderCategory
  available: boolean
  defaultModel: string
  models: ModelInfo[]
}

export function getAvailableProviders(): PublicProviderInfo[] {
  return PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    category: p.category,
    // Cloud: available iff its API-key env is set. Local: always reported
    // available — chat call surfaces a clear ECONNREFUSED if the server
    // isn't running, which is more useful than gating the picker here.
    available: p.category === 'local' ? true : !!(p.envKey && process.env[p.envKey]),
    defaultModel: p.defaultModel,
    models: p.models,
  }))
}

export function isModelValidForProvider(provider: string, model: string): boolean {
  const p = PROVIDERS.find(x => x.id === provider)
  if (!p) return false
  if (p.category === 'local') return typeof model === 'string' && model.length > 0
  return p.models.some(m => m.id === model)
}

// ─── Message shape passed in from the chat API route ────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ChatResult {
  message: string
  sources?: { title: string; url: string }[]
}

// Translate our incoming wire shape to AI SDK's ModelMessage[]. The first
// message is the system prompt — packaged as a SystemModelMessage so we can
// attach provider-specific options (Anthropic cacheControl) to it cleanly,
// rather than passing it as the bare `system:` parameter on streamText.
function toModelMessages(
  systemPrompt: string,
  messages: ChatMessage[],
  providerId: string,
): ModelMessage[] {
  const out: ModelMessage[] = []

  // System message — Anthropic prompt-caching marker goes here. The system
  // prompt is by definition stable across a multi-turn chat, so it's the
  // highest-leverage marker for cache hits. ephemeral = 5-min TTL, no extra
  // cost beyond a one-time cache-write fee on first turn; subsequent turns
  // pay ~10% of normal input tokens for the cached portion.
  out.push(
    providerId === 'anthropic'
      ? {
          role: 'system',
          content: systemPrompt,
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        }
      : { role: 'system', content: systemPrompt },
  )

  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
    } else {
      // Multimodal content — translate image_url blocks to AI SDK's image
      // part shape and text blocks to text parts. AI SDK narrows the role
      // type per message variant; the cast tells TS the runtime guarantee
      // (m.role is always 'user' for multimodal in practice — assistant
      // messages from our store are always plain strings).
      const parts = m.content.map(block => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text }
        return { type: 'image' as const, image: new URL(block.image_url.url) }
      })
      if (m.role === 'user') out.push({ role: 'user', content: parts })
      else out.push({ role: 'assistant', content: parts.filter(p => p.type === 'text') })
    }
  }

  return out
}

// ─── Tool definitions ───────────────────────────────────────────────────────

// Sources captured during a run so the UI can render them as citations.
// Populated by the Tavily web_search tool's execute() callback, and by
// provider-native search results that arrive as `source` chunks in the
// stream. MCP tool outputs are free-form and don't contribute here.
interface SourcesCollector { sources: { title: string; url: string }[] }

function buildTavilySearchTool(collector: SourcesCollector) {
  return tool({
    description:
      'Search the web for current information. Use for facts that may have changed since training, ' +
      'news, current events, or anything requiring up-to-date knowledge. Returns ranked results with snippets.',
    inputSchema: jsonSchema<{ query: string; max_results?: number }>({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query — be specific and concise.' },
        max_results: {
          type: 'number',
          description: 'Number of results to return (1-10). Default 5.',
          minimum: 1, maximum: 10,
        },
      },
      required: ['query'],
    }),
    execute: async ({ query, max_results }) => {
      const out = await tavilySearch(query, max_results ?? 5)
      // Capture for UI citation rendering.
      for (const r of out.results) collector.sources.push({ title: r.title, url: r.url })
      return out
    },
  })
}

// Wrap each MCP server's tools as AI SDK tools. Names are kept namespaced
// (<serverId>__<toolName>) to avoid collisions across servers.
async function buildMcpTools(serverIds: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {}
  if (!serverIds.length) return out
  const mcpTools = await getToolsForServers(serverIds)
  for (const t of mcpTools) {
    out[t.function.name] = tool({
      description: t.function.description,
      // MCP tools come with arbitrary JSON Schemas — we accept whatever
      // shape the server declares and pass the validated args through.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: jsonSchema<Record<string, unknown>>(t.function.parameters as any),
      execute: async (args) => {
        if (!isMcpToolName(t.function.name)) {
          return { error: `Tool '${t.function.name}' is not a known MCP tool` }
        }
        const raw = await executeMcpToolCall(t.function.name, args)
        try { return JSON.parse(raw) } catch { return { text: raw } }
      },
    })
  }
  return out
}

// ─── Search backend resolution ──────────────────────────────────────────────

export type SearchBackend = 'native' | 'tavily' | 'auto'

function readBackendFlag(): SearchBackend {
  const raw = (process.env.MAGPIE_SEARCH_BACKEND ?? 'auto').toLowerCase()
  if (raw === 'native' || raw === 'tavily') return raw
  return 'auto'
}

// Provider-native search: returns the tool entries to register on the
// request, or null if the provider has no native search. Some providers
// (Perplexity) search on every request without needing a tool slot —
// they return an empty tools object so the source-chunk collection path
// still gets activated.
interface NativeSearch {
  tools: Record<string, unknown>
}

function getNativeSearch(providerId: string): NativeSearch | null {
  switch (providerId) {
    case 'anthropic':
      // Anthropic's server-side web search. We pick the 2025-03-05 version
      // (rather than 2026-02-09) because the newer one defaults to
      // "programmatic" tool calling, which Haiku 4.5 doesn't support and
      // any model without the programmatic capability rejects with HTTP 400.
      // 2025-03-05 is the long-standing variant that works across all
      // current Claude models (Opus/Sonnet/Haiku). maxUses caps how many
      // separate search calls the model can issue per assistant turn;
      // 5 mirrors our MAX_TOOL_ROUNDS for parity.
      return { tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }) } }
    case 'gemini':
      // Google grounding via the Search tool. The provider routes this
      // through Gemini's built-in search grounding pipeline. Tool factories
      // aren't bound to a specific API key, so the default singleton is
      // fine here even though we use createGoogleGenerativeAI() for models.
      return { tools: { google_search: googleDefault.tools.googleSearch({}) } }
    case 'perplexity':
      // Sonar models search the web on every request — no tool slot needed.
      // The source-chunk path still picks up citations from the response.
      return { tools: {} }
    default:
      return null
  }
}

interface ResolvedSearch {
  source: 'native' | 'tavily' | 'none'
  tools: Record<string, unknown>
  // True when the active backend surfaces citations as AI SDK `source`
  // stream chunks (all native paths). Tavily routes them through the
  // tool's execute() callback instead and sets this false.
  consumeSourceChunks: boolean
}

function resolveSearch(
  webSearchEnabled: boolean,
  providerId: string,
  sources: SourcesCollector,
): ResolvedSearch {
  if (!webSearchEnabled) {
    return { source: 'none', tools: {}, consumeSourceChunks: false }
  }
  const backend = readBackendFlag()
  const native = getNativeSearch(providerId)
  const tavilyAvailable = !!process.env.TAVILY_API_KEY

  const tavilyChoice = (): ResolvedSearch => ({
    source: 'tavily',
    tools: { web_search: buildTavilySearchTool(sources) },
    consumeSourceChunks: false,
  })
  const noneChoice = (): ResolvedSearch => ({
    source: 'none', tools: {}, consumeSourceChunks: false,
  })

  if (backend === 'native') {
    return native
      ? { source: 'native', tools: native.tools, consumeSourceChunks: true }
      : noneChoice()
  }
  if (backend === 'tavily') {
    return tavilyAvailable ? tavilyChoice() : noneChoice()
  }
  // auto: prefer native (no extra API key, lower latency, no third-party hop).
  if (native) return { source: 'native', tools: native.tools, consumeSourceChunks: true }
  if (tavilyAvailable) return tavilyChoice()
  return noneChoice()
}

// Build the per-request tool map for AI SDK. Resolved search backend's
// tools plus any MCP server tools the user selected.
async function buildTools(
  resolvedSearch: ResolvedSearch,
  mcpServerIds: string[] | undefined,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = { ...resolvedSearch.tools }
  if (mcpServerIds && mcpServerIds.length > 0) {
    Object.assign(tools, await buildMcpTools(mcpServerIds))
  }
  return tools
}

const MAX_TOOL_ROUNDS = 5

// ─── Public API (signatures preserved from the token.js version) ────────────

export interface RunChatOptions {
  webSearch?: boolean
  temperature?: number
  mcpServers?: string[]
}

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_running'; name: string; query?: string }
  | { type: 'sources'; sources: { title: string; url: string }[] }

export async function runChat(
  messages: ChatMessage[],
  providerId: string = 'anthropic',
  model: string = 'claude-sonnet-4-6',
  systemPrompt: string = 'You are a helpful AI assistant.',
  options: RunChatOptions = {},
): Promise<ChatResult> {
  const p = findProvider(providerId)
  if (!p) throw new Error(`Unknown provider '${providerId}'`)

  const sourcesCollector: SourcesCollector = { sources: [] }
  const resolvedSearch = resolveSearch(!!options.webSearch, providerId, sourcesCollector)
  const tools = await buildTools(resolvedSearch, options.mcpServers)

  const result = await generateText({
    model: p.createModel(model),
    messages: toModelMessages(systemPrompt, messages, providerId),
    // The system prompt lives in the messages array (not as `system:`) so
    // we can attach Anthropic's cacheControl providerOption to it. Our
    // system prompt is operator-controlled config, not user input, so the
    // prompt-injection concern this flag warns about doesn't apply.
    allowSystemInMessages: true,
    tools: Object.keys(tools).length ? tools : undefined,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
  })

  // Native search paths surface citations through the response's sources
  // collection rather than the tool execute() callback — drain them here.
  if (resolvedSearch.consumeSourceChunks && result.sources?.length) {
    for (const s of result.sources) {
      if (s.sourceType === 'url') {
        sourcesCollector.sources.push({ title: s.title ?? s.url, url: s.url })
      }
    }
  }

  return {
    message: result.text,
    sources: sourcesCollector.sources.length ? sourcesCollector.sources : undefined,
  }
}

export async function* runChatStream(
  messages: ChatMessage[],
  providerId: string = 'anthropic',
  model: string = 'claude-sonnet-4-6',
  systemPrompt: string = 'You are a helpful AI assistant.',
  options: RunChatOptions = {},
): AsyncGenerator<StreamEvent, void, unknown> {
  const p = findProvider(providerId)
  if (!p) throw new Error(`Unknown provider '${providerId}'`)

  // Sources collector. Tavily pushes here via its execute() callback; native
  // search paths push from the `source` stream-chunk handler below. Either
  // way, freshly-collected sources are yielded to the UI in batches.
  const sourcesCollector: SourcesCollector = { sources: [] }
  const resolvedSearch = resolveSearch(!!options.webSearch, providerId, sourcesCollector)
  const tools = await buildTools(resolvedSearch, options.mcpServers)

  const result = streamText({
    model: p.createModel(model),
    messages: toModelMessages(systemPrompt, messages, providerId),
    // See runChat above — operator-controlled system prompt, so the
    // prompt-injection advisory doesn't apply.
    allowSystemInMessages: true,
    tools: Object.keys(tools).length ? tools : undefined,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
  })

  // Track how many sources we've already yielded so each tool round only
  // yields the newly-collected ones, not the full accumulating list.
  let yieldedSources = 0

  for await (const chunk of result.fullStream) {
    switch (chunk.type) {
      case 'text-delta':
        // AI SDK v6 uses `text` on text-delta chunks.
        if (chunk.text) yield { type: 'delta', content: chunk.text }
        break

      case 'tool-call': {
        // Surface the tool-running hint to the UI. Parse query out for nicer
        // labelling on the web_search case.
        let query: string | undefined
        if (chunk.toolName === 'web_search') {
          const input = chunk.input as { query?: string } | undefined
          query = input?.query
        }
        yield { type: 'tool_running', name: chunk.toolName, query }
        break
      }

      case 'tool-result':
        // After the tool finished, emit any newly-collected sources.
        if (sourcesCollector.sources.length > yieldedSources) {
          const fresh = sourcesCollector.sources.slice(yieldedSources)
          yieldedSources = sourcesCollector.sources.length
          yield { type: 'sources', sources: fresh }
        }
        break

      case 'source':
        // Provider-native search citations arrive as 'source' chunks in the
        // stream (Anthropic web_search, Google grounding, Perplexity Sonar).
        // Tavily uses the execute() collector path instead — guarded by the
        // resolvedSearch flag to avoid double-counting if a provider ever
        // surfaces sources alongside our tool's own results.
        if (resolvedSearch.consumeSourceChunks && chunk.sourceType === 'url') {
          const src = { title: chunk.title ?? chunk.url, url: chunk.url }
          sourcesCollector.sources.push(src)
          yieldedSources = sourcesCollector.sources.length
          yield { type: 'sources', sources: [src] }
        }
        break

      case 'error':
        // AI SDK surfaces upstream errors as a typed chunk; rethrow so the
        // chat route's catch handler formats it for the client.
        throw chunk.error instanceof Error
          ? chunk.error
          : new Error(String((chunk.error as { message?: string })?.message ?? chunk.error))

      default:
        // finish, finish-step, start, reasoning, source — not surfaced today.
        break
    }
  }
}
