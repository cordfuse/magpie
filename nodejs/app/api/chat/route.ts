import { NextRequest, NextResponse } from 'next/server'
import { getDeviceIdFromRequest } from '@/lib/server/jwt'
import {
  runChat, runChatStream, PROVIDERS, isModelValidForProvider, type Provider,
} from '@/lib/server/ai-tools'

export const maxDuration = 300

const DEFAULT_SYSTEM_PROMPT = process.env.QUILL_SYSTEM_PROMPT ?? 'You are a helpful AI assistant.'
const ENV_PROVIDER = (process.env.QUILL_PROVIDER ?? 'anthropic') as Provider
const ENV_MODEL = process.env.QUILL_MODEL ?? 'claude-sonnet-4-6'

// Provider → env var holding that provider's API key. token.js picks the
// key up from the env automatically; we just verify it's set before making
// the call so the operator gets a clear 503 instead of a downstream auth
// error from the provider SDK. Sourced from PROVIDERS registry so it stays
// in sync as we add providers.
const PROVIDER_KEY_ENVS: Record<string, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p.envKey]),
)

export async function POST(request: NextRequest) {
  console.log('[chat] request received')
  const deviceId = getDeviceIdFromRequest(request.headers.get('Authorization'))
  if (!deviceId) {
    console.log('[chat] unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { messages, stream: wantStream, provider: clientProvider, model: clientModel } = body

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 })
  }

  // Provider: prefer client choice if valid, else fall back to env default.
  let provider: Provider = ENV_PROVIDER
  if (typeof clientProvider === 'string') {
    const found = PROVIDERS.find(p => p.id === clientProvider)
    if (!found) {
      return NextResponse.json({ error: `Unknown provider '${clientProvider}'` }, { status: 400 })
    }
    provider = found.id
  }

  // Model: prefer client choice if it's known for the resolved provider,
  // else fall back to env default if it matches this provider, else use
  // the provider's defaultModel from the registry.
  const providerInfo = PROVIDERS.find(p => p.id === provider)!
  let model: string
  if (typeof clientModel === 'string') {
    if (!isModelValidForProvider(provider, clientModel)) {
      return NextResponse.json({
        error: `Model '${clientModel}' is not registered for provider '${provider}'`,
      }, { status: 400 })
    }
    model = clientModel
  } else if (provider === ENV_PROVIDER && isModelValidForProvider(provider, ENV_MODEL)) {
    model = ENV_MODEL
  } else {
    model = providerInfo.defaultModel
  }

  const requiredKey = PROVIDER_KEY_ENVS[provider]
  if (requiredKey && !process.env[requiredKey]) {
    return NextResponse.json({
      error: `Service unavailable — ${requiredKey} not set for provider '${provider}'.`,
    }, { status: 503 })
  }

  console.log(`[chat] msgs=${messages.length} provider=${provider} model=${model} stream=${!!wantStream}`)

  if (wantStream) {
    const enc = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
        try {
          for await (const delta of runChatStream(messages, provider, model, DEFAULT_SYSTEM_PROMPT)) {
            send({ type: 'delta', content: delta })
          }
          send({ type: 'done' })
          console.log('[chat] stream done')
        } catch (err) {
          console.error('[chat] stream error:', err)
          const message = err instanceof Error ? err.message : 'Internal server error'
          send({ type: 'error', message })
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
    const result = await runChat(messages, provider, model, DEFAULT_SYSTEM_PROMPT)
    console.log('[chat] done')
    return NextResponse.json(result)
  } catch (err) {
    console.error('[chat] error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
