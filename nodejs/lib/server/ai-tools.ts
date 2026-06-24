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

// token.js v0.7.1's built-in Anthropic model list tops out at
// claude-3-7-sonnet. Register the Claude 4.x family explicitly so
// requests against claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5
// don't get rejected by token.js's compile-time / runtime checks.
// Update this list as Anthropic releases new models; token.js core may
// catch up in future versions.
const tokenjs = new TokenJS()
tokenjs.extendModelList('anthropic', 'claude-opus-4-7',          { streaming: true, json: false, toolCalls: true, images: true })
tokenjs.extendModelList('anthropic', 'claude-sonnet-4-6',        { streaming: true, json: false, toolCalls: true, images: true })
tokenjs.extendModelList('anthropic', 'claude-haiku-4-5-20251001',{ streaming: true, json: false, toolCalls: true, images: true })

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
