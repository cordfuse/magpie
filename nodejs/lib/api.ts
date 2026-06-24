import { v4 as uuidv4 } from 'uuid'
import type { Message } from './types'

// OpenAI-style multimodal content. Used for messages that include images.
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface MultimodalMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ChatResponse {
  message: string
  sources?: { title: string; url: string }[]
}

const BASE = '/api'

function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('device_id')
  if (!id) { id = uuidv4(); localStorage.setItem('device_id', id) }
  return id
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('auth_token')
}

function setToken(token: string) {
  localStorage.setItem('auth_token', token)
}

async function authenticate(): Promise<void> {
  const res = await fetch(`${BASE}/auth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId() }),
  })
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`)
  const data = await res.json()
  setToken(data.token)
}

export async function initAuth(): Promise<void> {
  if (!getToken()) await authenticate()
}

// ─── Providers ───────────────────────────────────────────────────────────────

export interface ProviderModel {
  id: string
  label: string
}

export interface AvailableProvider {
  id: string
  label: string
  category: 'cloud' | 'local'
  available: boolean
  defaultModel: string
  models: ProviderModel[]
}

export async function getProviders(): Promise<AvailableProvider[]> {
  let token = getToken()
  if (!token) {
    await authenticate()
    token = getToken()!
  }
  const res = await fetch(`${BASE}/providers`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    localStorage.removeItem('auth_token')
    await authenticate()
    return getProviders()
  }
  if (!res.ok) throw new Error(`Providers fetch failed: ${res.status}`)
  const data = await res.json()
  return data.providers ?? []
}

export interface ProviderModelsResult {
  models: ProviderModel[]
  source: 'live' | 'registry'
}

// For local providers this probes the local server's /v1/models endpoint
// and returns whatever's installed. For cloud providers returns the
// curated registry list.
export async function extractDocument(name: string, mimeType: string, dataBase64: string): Promise<string> {
  let token = getToken()
  if (!token) {
    await authenticate()
    token = getToken()!
  }
  const res = await fetch(`${BASE}/extract-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, mimeType, dataBase64 }),
  })
  if (res.status === 401) {
    localStorage.removeItem('auth_token')
    await authenticate()
    return extractDocument(name, mimeType, dataBase64)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `Extraction failed: ${res.status}`)
  return data.text ?? ''
}

export async function getProviderModels(providerId: string): Promise<ProviderModelsResult> {
  let token = getToken()
  if (!token) {
    await authenticate()
    token = getToken()!
  }
  const res = await fetch(`${BASE}/providers/${encodeURIComponent(providerId)}/models`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    localStorage.removeItem('auth_token')
    await authenticate()
    return getProviderModels(providerId)
  }
  if (!res.ok) throw new Error(`Models fetch failed: ${res.status}`)
  const data = await res.json()
  return { models: data.models ?? [], source: data.source ?? 'registry' }
}

export interface ChatOpts {
  provider?: string
  model?: string
}

export async function sendChat(messages: Message[] | MultimodalMessage[], signal?: AbortSignal, opts: ChatOpts = {}): Promise<ChatResponse> {
  let token = getToken()
  if (!token) {
    await authenticate()
    token = getToken()!
  }

  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages, ...opts }),
  })

  if (res.status === 401) {
    localStorage.removeItem('auth_token')
    await authenticate()
    return sendChat(messages, signal, opts)
  }

  if (!res.ok) {
    let message = `Server error ${res.status}`
    try {
      const body = await res.json()
      if (body?.error && typeof body.error === 'string') message = body.error
    } catch { /* ignore parse errors */ }
    throw new Error(message)
  }

  const data = await res.json()
  return {
    message: data.message ?? '',
    sources: data.sources,
  }
}

export async function sendChatStream(
  messages: Message[] | MultimodalMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  opts: ChatOpts = {},
): Promise<ChatResponse> {
  let token = getToken()
  if (!token) {
    await authenticate()
    token = getToken()!
  }

  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages, stream: true, ...opts }),
  })

  if (res.status === 401) {
    localStorage.removeItem('auth_token')
    await authenticate()
    return sendChatStream(messages, onDelta, signal, opts)
  }

  if (!res.ok || !res.body) {
    let message = `Server error ${res.status}`
    try {
      const body = await res.json()
      if (body?.error && typeof body.error === 'string') message = body.error
    } catch { /* ignore parse errors */ }
    throw new Error(message)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      if (!evt.startsWith('data: ')) continue
      const payload = evt.slice(6)
      let obj: { type: string; content?: string; message?: string }
      try {
        obj = JSON.parse(payload)
      } catch {
        continue
      }
      if (obj.type === 'delta' && obj.content) {
        accumulated += obj.content
        onDelta(obj.content)
      } else if (obj.type === 'error') {
        throw new Error(obj.message ?? 'Stream error')
      }
    }
  }

  return { message: accumulated }
}
