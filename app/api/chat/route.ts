import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDeviceIdFromRequest } from '@/lib/server/jwt'
import { runChat } from '@/lib/server/ai-tools'

export const maxDuration = 300

const DEFAULT_SYSTEM_PROMPT =
  process.env.QUILL_SYSTEM_PROMPT ?? 'You are a helpful AI assistant.'

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

  // System prompt — minimal baseline. Override via QUILL_SYSTEM_PROMPT env var.
  // Marked ephemeral so Anthropic caches the prefix on repeat turns (cheap when stable).
  const systemFull = [
    { type: 'text' as const, text: DEFAULT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
  ]

  console.log(`[chat] msgs=${messages.length}`)

  try {
    const serverKey = process.env.ANTHROPIC_API_KEY
    if (!serverKey) {
      return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 })
    }
    const model = process.env.QUILL_MODEL || 'claude-sonnet-4-6'
    console.log(`[chat] model=${model}`)
    const client = new Anthropic({ apiKey: serverKey })
    const result = await runChat(client, messages, model, systemFull)

    console.log(`[chat] done`)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[chat] error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
