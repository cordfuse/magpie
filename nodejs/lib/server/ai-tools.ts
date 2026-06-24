import { TokenJS } from 'token.js'

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

export interface ProviderInfo {
  id: Provider
  label: string
  envKey: string         // env var that must be set for this provider to be usable
  defaultModel: string
  models: ModelInfo[]
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o',         label: 'GPT-4o' },
      { id: 'gpt-4o-mini',    label: 'GPT-4o mini' },
      { id: 'gpt-4-turbo',    label: 'GPT-4 Turbo' },
      { id: 'o1-preview',     label: 'o1 preview' },
      { id: 'o1-mini',        label: 'o1 mini' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash-001',
    models: [
      { id: 'gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro',       label: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash',     label: 'Gemini 1.5 Flash' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B Instant' },
      { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8×7B' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest',     label: 'Codestral' },
    ],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    envKey: 'COHERE_API_KEY',
    defaultModel: 'command-r-plus',
    models: [
      { id: 'command-r-plus', label: 'Command R+' },
      { id: 'command-r',      label: 'Command R' },
      { id: 'command',        label: 'Command' },
    ],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    envKey: 'PERPLEXITY_API_KEY',
    defaultModel: 'llama-3.1-sonar-large-128k-online',
    models: [
      { id: 'llama-3.1-sonar-large-128k-online', label: 'Sonar Large (online)' },
      { id: 'llama-3.1-sonar-small-128k-online', label: 'Sonar Small (online)' },
    ],
  },
  {
    id: 'ai21',
    label: 'AI21',
    envKey: 'AI21_API_KEY',
    defaultModel: 'jamba-1.5-large',
    models: [
      { id: 'jamba-1.5-large', label: 'Jamba 1.5 Large' },
      { id: 'jamba-1.5-mini',  label: 'Jamba 1.5 Mini' },
    ],
  },
  {
    id: 'bedrock',
    label: 'AWS Bedrock',
    envKey: 'AWS_ACCESS_KEY_ID',
    defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    models: [
      { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Bedrock Claude 3.5 Sonnet' },
      { id: 'meta.llama3-1-70b-instruct-v1:0',           label: 'Bedrock Llama 3.1 70B' },
    ],
  },
]

// Register every non-built-in model with token.js. Without this, requests
// against frontier models that token.js's internal list doesn't know about
// yet will fail with a runtime "unsupported model" error before they even
// reach the provider.
const tokenjs = new TokenJS()
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
  for (const m of p.models) ensureExtended(p.id, m.id)
}

export function getAvailableProviders(): { id: Provider; label: string; available: boolean; defaultModel: string; models: ModelInfo[] }[] {
  return PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    available: !!process.env[p.envKey],
    defaultModel: p.defaultModel,
    models: p.models,
  }))
}

export function isModelValidForProvider(provider: string, model: string): boolean {
  const p = PROVIDERS.find(x => x.id === provider)
  if (!p) return false
  return p.models.some(m => m.id === model)
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  message: string
  sources?: { title: string; url: string }[]
}

export async function runChat(
  messages: ChatMessage[],
  provider: Provider = 'anthropic',
  model: string = 'claude-sonnet-4-6',
  systemPrompt: string = 'You are a helpful AI assistant.',
): Promise<ChatResult> {
  const apiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  const response = await tokenjs.chat.completions.create({
    provider,
    model,
    messages: apiMessages,
  })

  const text = response.choices[0]?.message?.content ?? ''
  const usage = response.usage
  if (usage) {
    console.log(`[chat] in=${usage.prompt_tokens} out=${usage.completion_tokens}`)
  }

  // NOTE: Anthropic-native web search was dropped in this swap — it doesn't
  // exist on the OpenAI-shaped surface that token.js exposes. If you want
  // web search back, implement it as a tool call (works across providers,
  // requires defining the tool schema + handling tool_use in a loop) or
  // wrap a provider-specific search path. Sources field is preserved on the
  // ChatResult type for forward compatibility.

  return { message: text }
}

export async function* runChatStream(
  messages: ChatMessage[],
  provider: Provider = 'anthropic',
  model: string = 'claude-sonnet-4-6',
  systemPrompt: string = 'You are a helpful AI assistant.',
): AsyncGenerator<string, void, unknown> {
  const apiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  const stream = await tokenjs.chat.completions.create({
    provider,
    model,
    messages: apiMessages,
    stream: true,
  })

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }
}
