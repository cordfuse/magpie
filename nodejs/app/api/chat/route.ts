import { NextRequest, NextResponse } from 'next/server'
import { getDeviceIdFromRequest } from '@/lib/server/jwt'
import { runChat, type Provider } from '@/lib/server/ai-tools'

export const maxDuration = 300

const DEFAULT_SYSTEM_PROMPT = process.env.QUILL_SYSTEM_PROMPT ?? 'You are a helpful AI assistant.'
const DEFAULT_PROVIDER = (process.env.QUILL_PROVIDER ?? 'anthropic') as Provider
const DEFAULT_MODEL = process.env.QUILL_MODEL ?? 'claude-sonnet-4-6'

// Provider → env var holding that provider's API key. token.js picks the
// key up from the env automatically; we just verify it's set before making
// the call so the operator gets a clear 503 instead of a downstream auth
// error from the provider SDK.
const PROVIDER_KEY_ENVS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cohere: 'COHERE_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  bedrock: 'AWS_ACCESS_KEY_ID',
  ai21: 'AI21_API_KEY',
}

export async function POST(request: NextRequest) {
  console.log('[chat] request received')
  const deviceId = getDeviceIdFromRequest(request.headers.get('Authorization'))
  if (!deviceId) {
    console.log('[chat] unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { messages } = body

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 })
  }

  const requiredKey = PROVIDER_KEY_ENVS[DEFAULT_PROVIDER]
  if (requiredKey && !process.env[requiredKey]) {
    return NextResponse.json({
      error: `Service unavailable — ${requiredKey} not set for provider '${DEFAULT_PROVIDER}'.`,
    }, { status: 503 })
  }

  console.log(`[chat] msgs=${messages.length} provider=${DEFAULT_PROVIDER} model=${DEFAULT_MODEL}`)

  try {
    const result = await runChat(messages, DEFAULT_PROVIDER, DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT)
    console.log('[chat] done')
    return NextResponse.json(result)
  } catch (err) {
    console.error('[chat] error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
