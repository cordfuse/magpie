import Anthropic from '@anthropic-ai/sdk'

// Native web search tool — Anthropic executes it server-side and returns
// `web_search_tool_result` blocks alongside the response. No manual tool
// loop needed. Override the version via WEB_SEARCH_TOOL_VERSION env var.
function getNativeWebSearchTool(): { type: string; name: 'web_search' } {
  return { type: process.env.WEB_SEARCH_TOOL_VERSION ?? 'web_search_20250305', name: 'web_search' }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  message: string
  sources?: { title: string; url: string }[]
}

function extractSources(content: Anthropic.ContentBlock[]): { title: string; url: string }[] {
  const sources: { title: string; url: string }[] = []
  for (const block of content) {
    if (block.type === 'web_search_tool_result') {
      const results = block.content
      if (Array.isArray(results)) {
        for (const r of results) {
          if (r.type === 'web_search_result') {
            sources.push({ title: r.title, url: r.url })
          }
        }
      }
    }
  }
  return sources
}

type SystemInput = string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>

export async function runChat(
  client: Anthropic,
  messages: ChatMessage[],
  model = 'claude-sonnet-4-6',
  systemPrompt: SystemInput = 'You are a helpful AI assistant.',
): Promise<ChatResult> {
  const tools = [getNativeWebSearchTool()] as Anthropic.MessageCreateParams['tools']
  const apiMessages: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }))

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages: apiMessages,
  })

  const u = response.usage as unknown as Record<string, number>
  console.log(`[cache] in=${u.input_tokens} out=${u.output_tokens} cache_create=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`)

  const sources = extractSources(response.content as Anthropic.ContentBlock[])
  const textBlock = response.content.find(b => b.type === 'text')
  return {
    message: textBlock?.type === 'text' ? textBlock.text : '',
    sources: sources.length > 0 ? sources : undefined,
  }
}
