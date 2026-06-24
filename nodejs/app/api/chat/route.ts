import { NextRequest, NextResponse } from 'next/server'
import { getDeviceIdFromRequest } from '@/lib/server/jwt'
import {
  runChat, runChatStream, findProvider, isModelValidForProvider,
} from '@/lib/server/ai-tools'
import { loadQuillConfig, loadKioskFlags } from '@/lib/config'
import { listServers } from '@/lib/server/mcp'

export const maxDuration = 300

const ENV_PROVIDER = process.env.QUILL_PROVIDER ?? 'anthropic'
const ENV_MODEL = process.env.QUILL_MODEL ?? 'claude-sonnet-4-6'

// System prompt resolution chain: client per-request → QUILL_SYSTEM_PROMPT
// env → quill.config.json defaultSystemPrompt → hardcoded fallback.
// Config is read fresh per request so drop-in JSON changes apply immediately.
function getDefaultSystemPrompt(): string {
  if (process.env.QUILL_SYSTEM_PROMPT) return process.env.QUILL_SYSTEM_PROMPT
  return loadQuillConfig().config.defaultSystemPrompt
}

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
  return getDefaultSystemPrompt()
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

  // Kiosk visibility flags. When a UI control is hidden, the client can't
  // send that field — so the server falls back to: env-configured value
  // (provider/model), or feature-always-on with whatever's configured
  // (web search if TAVILY set; all MCP servers from quill-mcp.json).
  const flags = loadKioskFlags()

  // Provider: when picker is hidden, ignore client choice and use env default.
  // Otherwise, prefer client choice if valid, else env default.
  let providerId = ENV_PROVIDER
  if (flags.showModelPicker && typeof clientProvider === 'string') {
    if (!findProvider(clientProvider)) {
      return NextResponse.json({ error: `Unknown provider '${clientProvider}'` }, { status: 400 })
    }
    providerId = clientProvider
  }
  const providerInfo = findProvider(providerId)
  if (!providerInfo) {
    return NextResponse.json({ error: `Unknown provider '${providerId}'` }, { status: 400 })
  }

  // Model: when picker is hidden, ignore client choice. Otherwise prefer
  // client → env default (if matches) → provider's defaultModel from registry.
  let model: string
  if (flags.showModelPicker && typeof clientModel === 'string') {
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

  // Web search: when toggle is hidden, force ON if TAVILY key is set
  // (otherwise silently off — no error, picker is hidden so user can't have
  // asked for it). When toggle is visible, honor the client flag.
  const hasTavily = !!process.env.TAVILY_API_KEY
  const wantWebSearch = flags.showWebSearch
    ? !!webSearch
    : hasTavily
  if (flags.showWebSearch && wantWebSearch && !hasTavily) {
    return NextResponse.json({
      error: 'Web search is on but TAVILY_API_KEY isn\'t set on the server.',
    }, { status: 503 })
  }

  // MCP: when picker is hidden, use every configured + available server.
  // When picker is visible, honor the client's selection.
  let mcpServers: string[]
  if (flags.showMcp) {
    mcpServers = Array.isArray(clientMcpServers)
      ? clientMcpServers.filter((s): s is string => typeof s === 'string')
      : []
  } else {
    const all = await listServers()
    mcpServers = all.filter(s => s.available).map(s => s.id)
  }

  const systemPrompt = resolveSystemPrompt(clientSystemPrompt)
  const temperature  = resolveTemperature(clientTemperature)
  const runOpts = { webSearch: wantWebSearch, temperature, mcpServers }

  console.log(`[chat] msgs=${messages.length} provider=${provider} model=${model} stream=${!!wantStream} websearch=${wantWebSearch} mcps=${mcpServers.length ? mcpServers.join(',') : '-'} temp=${temperature}`)

  if (wantStream) {
    const enc = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Track whether the underlying response stream is still writable.
        // Mobile browsers + reverse proxies kill long-idle SSE connections
        // (we saw 78s MS Learn responses drop on mobile). Once the client
        // is gone, controller.enqueue throws ERR_INVALID_STATE — guard so
        // we don't spam the log and so heartbeat cleanly self-terminates.
        let closed = false
        const safeEnqueue = (chunk: Uint8Array): boolean => {
          if (closed) return false
          try {
            controller.enqueue(chunk)
            return true
          } catch {
            closed = true
            return false
          }
        }
        const send = (obj: unknown) =>
          safeEnqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))

        // Heartbeat: emit an SSE comment line every 8s while the stream is
        // open. The line is ignored by the client parser but keeps the TCP
        // socket warm so phones / proxies don't reap it on idle. First tick
        // fires after the interval — long enough that fast responses never
        // see a ping in their log.
        const HEARTBEAT_MS = 8000
        const PING = enc.encode(': ping\n\n')
        const heartbeat = setInterval(() => {
          if (!safeEnqueue(PING)) clearInterval(heartbeat)
        }, HEARTBEAT_MS)

        try {
          for await (const event of runChatStream(messages, provider, model, systemPrompt, runOpts)) {
            // runChatStream yields typed events directly — forward as-is.
            send(event)
          }
          send({ type: 'done' })
          console.log('[chat] stream done')
        } catch (err) {
          // ERR_INVALID_STATE from a disconnected client isn't a server
          // error — quietly note and move on. Real errors still log.
          const isClosedErr = (err as { code?: string })?.code === 'ERR_INVALID_STATE'
          if (isClosedErr || closed) {
            console.log('[chat] client disconnected mid-stream')
          } else {
            console.error('[chat] stream error:', err)
            send({ type: 'error', message: friendlyError(err) })
          }
        } finally {
          clearInterval(heartbeat)
          if (!closed) {
            try { controller.close() } catch { /* already closed */ }
          }
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
