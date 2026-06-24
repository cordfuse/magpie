import { TokenJS } from 'token.js'
import { WEB_SEARCH_TOOL, executeToolCall, type SearchResult } from './web-search'
import { getToolsForServers, executeMcpToolCall, isMcpToolName } from './mcp'

// token.js doesn't re-export its LLMProvider type from the main entry,
// so we mirror the union here. Update if token.js adds providers.
export type Provider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'cohere'
  | 'bedrock'
  | 'mistral'
  | 'groq'
  | 'perplexity'
  | 'ai21'
  | 'openrouter'
  | 'openai-compatible'

// ─── Model registry ──────────────────────────────────────────────────────────
//
// Sensible default model set per provider. Used by:
//   - the /api/providers endpoint to expose models to the UI
//   - the /api/chat endpoint to validate the requested model
//
// token.js ships a built-in model list that lags the provider's actual
// frontier — we register the newer models explicitly via extendModelList
// below so requests against them aren't rejected by token.js's runtime
// checks. Update both blocks when adding a new model.

export interface ModelInfo {
  id: string
  label: string
}

export type ProviderCategory = 'cloud' | 'local'

export interface ProviderInfo {
  id: string                    // display id — unique key, not a token.js Provider for local
  label: string
  category: ProviderCategory
  tokenjsProvider: Provider     // actual token.js provider used for dispatch
  envKey?: string               // cloud: env var with the API key
  baseURLEnv?: string           // local: env var that overrides the baseURL
  defaultBaseURL?: string       // local: fallback baseURL when env unset
  defaultModel: string
  models: ModelInfo[]
}

export const PROVIDERS: ProviderInfo[] = [
  // ── cloud ──
  {
    id: 'anthropic', label: 'Anthropic', category: 'cloud',
    tokenjsProvider: 'anthropic', envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', category: 'cloud',
    tokenjsProvider: 'openai', envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o',      label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'o1-preview',  label: 'o1 preview' },
      { id: 'o1-mini',     label: 'o1 mini' },
    ],
  },
  {
    id: 'gemini', label: 'Google Gemini', category: 'cloud',
    tokenjsProvider: 'gemini', envKey: 'GEMINI_API_KEY',
    // Gemini 1.5 was deprecated server-side (v1beta returns 404). 2.5 is the
    // current stable family; 3.x is preview and would churn the list too fast.
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash-Lite' },
    ],
  },
  {
    id: 'groq', label: 'Groq', category: 'cloud',
    tokenjsProvider: 'groq', envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B Instant' },
      { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8×7B' },
    ],
  },
  {
    id: 'mistral', label: 'Mistral', category: 'cloud',
    tokenjsProvider: 'mistral', envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest',     label: 'Codestral' },
    ],
  },
  {
    id: 'cohere', label: 'Cohere', category: 'cloud',
    tokenjsProvider: 'cohere', envKey: 'COHERE_API_KEY',
    defaultModel: 'command-r-plus',
    models: [
      { id: 'command-r-plus', label: 'Command R+' },
      { id: 'command-r',      label: 'Command R' },
      { id: 'command',        label: 'Command' },
    ],
  },
  {
    id: 'perplexity', label: 'Perplexity', category: 'cloud',
    tokenjsProvider: 'perplexity', envKey: 'PERPLEXITY_API_KEY',
    defaultModel: 'llama-3.1-sonar-large-128k-online',
    models: [
      { id: 'llama-3.1-sonar-large-128k-online', label: 'Sonar Large (online)' },
      { id: 'llama-3.1-sonar-small-128k-online', label: 'Sonar Small (online)' },
    ],
  },
  {
    id: 'ai21', label: 'AI21', category: 'cloud',
    tokenjsProvider: 'ai21', envKey: 'AI21_API_KEY',
    defaultModel: 'jamba-1.5-large',
    models: [
      { id: 'jamba-1.5-large', label: 'Jamba 1.5 Large' },
      { id: 'jamba-1.5-mini',  label: 'Jamba 1.5 Mini' },
    ],
  },
  {
    id: 'bedrock', label: 'AWS Bedrock', category: 'cloud',
    tokenjsProvider: 'bedrock', envKey: 'AWS_ACCESS_KEY_ID',
    defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    models: [
      { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Bedrock Claude 3.5 Sonnet' },
      { id: 'meta.llama3-1-70b-instruct-v1:0',           label: 'Bedrock Llama 3.1 70B' },
    ],
  },
  // ── local (OpenAI-compatible servers running on the operator's machine) ──
  {
    id: 'ollama', label: 'Ollama', category: 'local',
    tokenjsProvider: 'openai-compatible',
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
  },
  {
    id: 'llamacpp', label: 'llama.cpp', category: 'local',
    tokenjsProvider: 'openai-compatible',
    baseURLEnv: 'LLAMACPP_BASE_URL', defaultBaseURL: 'http://localhost:8080/v1',
    defaultModel: 'loaded-model',
    models: [
      { id: 'loaded-model', label: 'Currently loaded model' },
    ],
  },
  {
    id: 'lmstudio', label: 'LM Studio', category: 'local',
    tokenjsProvider: 'openai-compatible',
    baseURLEnv: 'LMSTUDIO_BASE_URL', defaultBaseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: [
      { id: 'local-model',                 label: 'Currently loaded model' },
      { id: 'llama-3.2-3b-instruct',       label: 'Llama 3.2 3B Instruct' },
      { id: 'qwen2.5-7b-instruct',         label: 'Qwen 2.5 7B Instruct' },
      { id: 'mistral-7b-instruct-v0.3',    label: 'Mistral 7B Instruct v0.3' },
    ],
  },
]

function resolveBaseURL(p: ProviderInfo): string | undefined {
  if (p.category !== 'local') return undefined
  if (p.baseURLEnv && process.env[p.baseURLEnv]) return process.env[p.baseURLEnv]
  return p.defaultBaseURL
}

export function findProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find(p => p.id === id)
}

// Register every non-built-in model with token.js. Without this, requests
// against frontier models that token.js's internal list doesn't know about
// yet will fail with a runtime "unsupported model" error before they even
// reach the provider.
const tokenjs = new TokenJS()

// token.js's `openai-compatible` provider requires baseURL at constructor
// time — passing it as a call option is silently ignored. We keep one
// dedicated TokenJS instance per local provider, lazily created on first
// use, so each carries the right baseURL into every dispatch.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localInstances = new Map<string, any>()
function getTokenInstance(p: ProviderInfo) {
  if (p.category !== 'local') return tokenjs
  const baseURL = resolveBaseURL(p)
  if (!baseURL) return tokenjs
  const key = `${p.id}:${baseURL}`
  let inst = localInstances.get(key)
  if (!inst) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inst = new (TokenJS as any)({ baseURL })
    localInstances.set(key, inst)
  }
  return inst
}
const _extended = new Set<string>()
function ensureExtended(provider: Provider, model: string) {
  const key = `${provider}:${model}`
  if (_extended.has(key)) return
  _extended.add(key)
  try {
    // Best-effort — token.js may already know the model, in which case
    // extendModelList is a harmless override. Some providers (openrouter,
    // openai-compatible) don't accept extendModelList — we skip them.
    if (provider === 'openrouter' || provider === 'openai-compatible') return
    tokenjs.extendModelList(provider, model, {
      streaming: true, json: false, toolCalls: true, images: true,
    })
  } catch {
    /* token.js validation rejected the model — fall through, the actual
       chat call will surface a more specific error to the operator. */
  }
}
for (const p of PROVIDERS) {
  for (const m of p.models) ensureExtended(p.tokenjsProvider, m.id)
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
    // Cloud: available iff its API-key env var is set.
    // Local: always reported available (we can't cheaply probe the local
    // server here; the chat call will surface a clear ECONNREFUSED if the
    // operator's local server isn't actually running).
    available: p.category === 'local' ? true : !!(p.envKey && process.env[p.envKey]),
    defaultModel: p.defaultModel,
    models: p.models,
  }))
}

export function isModelValidForProvider(provider: string, model: string): boolean {
  const p = PROVIDERS.find(x => x.id === provider)
  if (!p) return false
  // Local servers can serve any model name the operator has loaded;
  // we can't enumerate that. Skip strict validation for local providers.
  if (p.category === 'local') return typeof model === 'string' && model.length > 0
  return p.models.some(m => m.id === model)
}

// OpenAI-style multimodal content. token.js converts this to each provider's
// native format internally (Anthropic image blocks, Gemini inlineData, etc).
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

function buildCallOptions(
  p: ProviderInfo,
  model: string,
  apiMessages: unknown[],
  stream: boolean,
  tools: unknown[] | null,
  temperature?: number,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = { provider: p.tokenjsProvider, model, messages: apiMessages, stream }
  // For openai-compatible providers token.js requires the baseURL in the
  // constructor (handled by getTokenInstance) but still expects a non-empty
  // apiKey on the call. Most local servers accept any string.
  if (p.category === 'local') opts.apiKey = 'local'
  if (tools && tools.length > 0) opts.tools = tools
  if (typeof temperature === 'number') opts.temperature = temperature
  return opts
}

// Build the per-request tool list: web_search (if enabled) plus all tools
// from the user's selected MCP servers. Returns null if no tools are active
// (so we don't pass an empty array to providers that complain).
async function buildToolList(
  webSearch: boolean,
  mcpServerIds: string[] | undefined,
): Promise<unknown[] | null> {
  const tools: unknown[] = []
  if (webSearch) tools.push(WEB_SEARCH_TOOL)
  if (mcpServerIds && mcpServerIds.length > 0) {
    const mcpTools = await getToolsForServers(mcpServerIds)
    for (const t of mcpTools) tools.push(t)
  }
  return tools.length > 0 ? tools : null
}

// Dispatch a tool call to either the built-in web_search executor or the
// matching MCP client. Always returns a string (the model's tool message).
async function dispatchToolCall(name: string, argsJson: string): Promise<string> {
  if (isMcpToolName(name)) {
    try {
      const args = argsJson ? JSON.parse(argsJson) : {}
      return await executeMcpToolCall(name, args)
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : 'MCP tool call failed' })
    }
  }
  return executeToolCall(name, argsJson)
}

// Safety limit on tool-call rounds — prevents a model from looping
// indefinitely (search → think → search → think → ...).
const MAX_TOOL_ROUNDS = 5

interface AccumulatedToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface SystemMessage { role: 'system'; content: string }
interface UserMessage   { role: 'user'; content: string | ContentBlock[] }
interface AsstTextMsg   { role: 'assistant'; content: string }
interface AsstToolMsg   { role: 'assistant'; content: string | null; tool_calls: AccumulatedToolCall[] }
interface ToolResultMsg { role: 'tool'; tool_call_id: string; content: string }
type WireMessage = SystemMessage | UserMessage | AsstTextMsg | AsstToolMsg | ToolResultMsg

export interface RunChatOptions {
  webSearch?: boolean
  temperature?: number
  mcpServers?: string[]
}

// Yielded by runChatStream — text deltas plus optional events the route
// can forward to the UI (search-in-progress, sources after a search round).
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

  const inst = getTokenInstance(p)
  const wireMessages: WireMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })) as (UserMessage | AsstTextMsg)[],
  ]

  const sources: { title: string; url: string }[] = []
  const tools = await buildToolList(!!options.webSearch, options.mcpServers)

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await inst.chat.completions.create(
      buildCallOptions(p, model, wireMessages, false, tools, options.temperature),
    )
    const choice = response.choices[0]
    const usage = response.usage
    if (usage) console.log(`[chat] round=${round} in=${usage.prompt_tokens} out=${usage.completion_tokens}`)

    const msg = choice?.message
    const toolCalls = (msg?.tool_calls ?? []) as AccumulatedToolCall[]
    if (!toolCalls.length) {
      return { message: msg?.content ?? '', sources: sources.length ? sources : undefined }
    }

    wireMessages.push({ role: 'assistant', content: msg?.content ?? null, tool_calls: toolCalls })
    for (const tc of toolCalls) {
      const result = await dispatchToolCall(tc.function.name, tc.function.arguments)
      wireMessages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      // Mine sources for the UI (web_search results only — MCP tool outputs
      // are free-form and don't share the SearchResult shape).
      if (tc.function.name === 'web_search') {
        try {
          const parsed = JSON.parse(result) as { results?: SearchResult[] }
          if (Array.isArray(parsed.results)) {
            for (const r of parsed.results) sources.push({ title: r.title, url: r.url })
          }
        } catch { /* skip */ }
      }
    }
  }

  return { message: '(reached max tool-call rounds)', sources: sources.length ? sources : undefined }
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

  const inst = getTokenInstance(p)
  const wireMessages: WireMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })) as (UserMessage | AsstTextMsg)[],
  ]

  const tools = await buildToolList(!!options.webSearch, options.mcpServers)

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // token.js's create() is overloaded on `stream: true`; cast the result
    // to the streaming iterable shape to keep TS happy.
    const stream = await inst.chat.completions.create(
      buildCallOptions(p, model, wireMessages, true, tools, options.temperature),
    ) as unknown as AsyncIterable<{
      choices: Array<{
        delta?: {
          content?: string
          tool_calls?: Array<{
            index: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        finish_reason?: string | null
      }>
    }>

    const accumulatedToolCalls: AccumulatedToolCall[] = []
    let accumulatedText = ''
    let finishReason: string | null = null

    for await (const chunk of stream) {
      const c = chunk.choices[0]
      if (c?.delta?.content) {
        accumulatedText += c.delta.content
        yield { type: 'delta', content: c.delta.content }
      }
      if (c?.delta?.tool_calls) {
        for (const tcDelta of c.delta.tool_calls) {
          const i = tcDelta.index ?? 0
          if (!accumulatedToolCalls[i]) {
            accumulatedToolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } }
          }
          if (tcDelta.id) accumulatedToolCalls[i].id = tcDelta.id
          if (tcDelta.function?.name) accumulatedToolCalls[i].function.name += tcDelta.function.name
          if (tcDelta.function?.arguments) accumulatedToolCalls[i].function.arguments += tcDelta.function.arguments
        }
      }
      if (c?.finish_reason) finishReason = c.finish_reason
    }

    const validToolCalls = accumulatedToolCalls.filter(tc => tc?.id && tc.function.name)
    if (!validToolCalls.length || finishReason !== 'tool_calls') return

    wireMessages.push({ role: 'assistant', content: accumulatedText || null, tool_calls: validToolCalls })

    for (const tc of validToolCalls) {
      // Try to parse the query out for the UI hint.
      let query: string | undefined
      try { query = (JSON.parse(tc.function.arguments) as { query?: string }).query } catch { /* skip */ }
      yield { type: 'tool_running', name: tc.function.name, query }

      const result = await dispatchToolCall(tc.function.name, tc.function.arguments)
      wireMessages.push({ role: 'tool', tool_call_id: tc.id, content: result })

      // Surface sources to the UI for web_search only — MCP tool results
      // don't share the SearchResult shape.
      if (tc.function.name === 'web_search') {
        try {
          const parsed = JSON.parse(result) as { results?: SearchResult[] }
          if (Array.isArray(parsed.results) && parsed.results.length) {
            yield {
              type: 'sources',
              sources: parsed.results.map(r => ({ title: r.title, url: r.url })),
            }
          }
        } catch { /* skip */ }
      }
    }
  }
}
