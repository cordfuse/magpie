import { NextRequest, NextResponse } from 'next/server'
import { getDeviceIdFromRequest } from '@/lib/server/jwt'
import {
  runChat, runChatStream, findProvider, isModelValidForProvider,
} from '@/lib/server/ai-tools'

export const maxDuration = 300

const DEFAULT_SYSTEM_PROMPT = process.env.QUILL_SYSTEM_PROMPT ?? 'You are a helpful AI assistant.'
const ENV_PROVIDER = process.env.QUILL_PROVIDER ?? 'anthropic'
const ENV_MODEL = process.env.QUILL_MODEL ?? 'claude-sonnet-4-6'

// Generation defaults — env var (operator deploy default) → hardcoded fallback.
// Client may override per-request via the request body; resolveGen() applies
// request → env → hardcoded.
const HARDCODED_TEMPERATURE = 1.0
function envNumber(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
function resolveTemperature(clientValue: unknown): number {
  if (typeof clientValue === 'number' && Number.isFinite(clientValue)) return clientValue
  return envNumber('QUILL_TEMPERATURE') ?? HARDCODED_TEMPERATURE
}
function resolveSystemPrompt(clientValue: unknown): string {
  if (typeof clientValue === 'string' && clientValue.trim().length > 0) return clientValue
  return DEFAULT_SYSTEM_PROMPT
}

export async function POST(request: NextRequest) {
  console.log('[chat] request received')
  const deviceId = getDeviceIdFromRequest(request.headers.get('Authorization'))
  if (!deviceId) {
    console.log('[chat] unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    messages, stream: wantStream,
    provider: clientProvider, model: clientModel,
    webSearch,
    mcpServers: clientMcpServers,
    systemPrompt: clientSystemPrompt,
    temperature: clientTemperature,
  } = body

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 })
  }

  // Provider: prefer client choice if valid, else fall back to env default.
  let providerId = ENV_PROVIDER
  if (typeof clientProvider === 'string') {
    if (!findProvider(clientProvider)) {
      return NextResponse.json({ error: `Unknown provider '${clientProvider}'` }, { status: 400 })
    }
    providerId = clientProvider
  }
  const providerInfo = findProvider(providerId)
  if (!providerInfo) {
    return NextResponse.json({ error: `Unknown provider '${providerId}'` }, { status: 400 })
  }

  // Model: prefer client choice if valid, else env default if it matches,
  // else the provider's defaultModel from the registry.
  let model: string
  if (typeof clientModel === 'string') {
    if (!isModelValidForProvider(providerId, clientModel)) {
      return NextResponse.json({
        error: `Model '${clientModel}' is not registered for provider '${providerId}'`,
      }, { status: 400 })
    }
    model = clientModel
  } else if (providerId === ENV_PROVIDER && isModelValidForProvider(providerId, ENV_MODEL)) {
    model = ENV_MODEL
  } else {
    model = providerInfo.defaultModel
  }

  // Cloud providers need an API key in the env. Local providers don't
  // (they hit a local OpenAI-compatible server with a sentinel apiKey).
  if (providerInfo.category === 'cloud') {
    const requiredKey = providerInfo.envKey
    if (requiredKey && !process.env[requiredKey]) {
      return NextResponse.json({
        error: `Service unavailable — ${requiredKey} not set for provider '${providerId}'.`,
      }, { status: 503 })
    }
  }

  const provider = providerId

  // Translate provider errors into actionable messages. ECONNREFUSED to a
  // local provider almost always means the operator's local server isn't
  // running (Ollama / llama.cpp / LM Studio). Surfacing "Connection error."
  // alone gives the user no clue what to fix.
  const friendlyError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err)
    const cause = (err as { cause?: { code?: string } })?.cause
    const isConnRefused = cause?.code === 'ECONNREFUSED' || /ECONNREFUSED|connection error|fetch failed/i.test(raw)
    if (isConnRefused && providerInfo.category === 'local') {
      const baseURL = providerInfo.defaultBaseURL
      const envHint = providerInfo.baseURLEnv ? ` (override with ${providerInfo.baseURLEnv})` : ''
      return `Couldn't reach ${providerInfo.label}${baseURL ? ` at ${baseURL}` : ''}. Is the server running?${envHint}`
    }
    // Model not installed on a local server (Ollama 404, llama.cpp similar).
    if (providerInfo.category === 'local' && /\b404\b|not found|no such model/i.test(raw)) {
      if (providerInfo.id === 'ollama') {
        return `Model '${model}' isn't installed on Ollama. Pull it with:  ollama pull ${model}`
      }
      return `Model '${model}' isn't loaded on ${providerInfo.label}. Load it on the server and retry.`
    }
    return raw || 'Internal server error'
  }

  // Honor the webSearch flag only if the server has Tavily configured.
  // Surface a clear 503 if the user enabled search but the operator hasn't
  // set TAVILY_API_KEY, so they know why their toggle's not working.
  const wantWebSearch = !!webSearch
  if (wantWebSearch && !process.env.TAVILY_API_KEY) {
    return NextResponse.json({
      error: 'Web search is on but TAVILY_API_KEY isn\'t set on the server.',
    }, { status: 503 })
  }
  const systemPrompt = resolveSystemPrompt(clientSystemPrompt)
  const temperature  = resolveTemperature(clientTemperature)
  const mcpServers   = Array.isArray(clientMcpServers)
    ? clientMcpServers.filter((s): s is string => typeof s === 'string')
    : []
  const runOpts = { webSearch: wantWebSearch, temperature, mcpServers }

  console.log(`[chat] msgs=${messages.length} provider=${provider} model=${model} stream=${!!wantStream} websearch=${wantWebSearch} mcps=${mcpServers.length ? mcpServers.join(',') : '-'} temp=${temperature}`)

  if (wantStream) {
    const enc = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
        try {
          for await (const event of runChatStream(messages, provider, model, systemPrompt, runOpts)) {
            // runChatStream yields typed events directly — forward as-is.
            send(event)
          }
          send({ type: 'done' })
          console.log('[chat] stream done')
        } catch (err) {
          console.error('[chat] stream error:', err)
          send({ type: 'error', message: friendlyError(err) })
        } finally {
          controller.close()
        }
      },
    })
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  try {
    const result = await runChat(messages, provider, model, systemPrompt, runOpts)
    console.log('[chat] done')
    return NextResponse.json(result)
  } catch (err) {
    console.error('[chat] error:', err)
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 })
  }
}
