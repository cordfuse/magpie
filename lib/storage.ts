import type { Conversation, ChatMessage } from './types'

// ─── Conversations ────────────────────────────────────────────────────────────

const CONV_KEY = 'quill_conversations'
const MAX_CONVERSATIONS = 50

export function loadConversations(): Conversation[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(CONV_KEY) ?? '[]') } catch { return [] }
}

function saveConversations(convs: Conversation[]) {
  localStorage.setItem(CONV_KEY, JSON.stringify(convs.slice(0, MAX_CONVERSATIONS)))
}

export function upsertConversation(conv: Conversation) {
  const all = loadConversations()
  const idx = all.findIndex(c => c.id === conv.id)
  if (idx >= 0) all[idx] = conv
  else all.unshift(conv)
  all.sort((a, b) => b.updatedAt - a.updatedAt)
  saveConversations(all)
}

export function deleteConversation(id: string) {
  saveConversations(loadConversations().filter(c => c.id !== id))
}

export function clearAllConversations() {
  localStorage.removeItem(CONV_KEY)
}

export function autoTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')?.content ?? 'New chat'
  return first.length > 42 ? first.slice(0, 42).trimEnd() + '…' : first
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString()
}

// ─── Theme ────────────────────────────────────────────────────────────────────
//
// 11 themes inherited from mighty-ai-qr-web. Names retain their guitar-amp
// flavor (tweed/amber/british/oxblood/silver/pedalboard/blackface/plexi);
// rename later if you want to neutralize the branding.

export type Theme = 'dark' | 'oled' | 'light' | 'tweed' | 'amber' | 'british' | 'oxblood' | 'silver' | 'pedalboard' | 'blackface' | 'plexi' | 'tweed-lt' | 'amber-lt' | 'british-lt' | 'oxblood-lt' | 'silver-lt' | 'pedalboard-lt' | 'blackface-lt' | 'plexi-lt'

const THEME_KEY = 'quill_theme'

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return (localStorage.getItem(THEME_KEY) as Theme) ?? 'dark'
}

export function saveTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme)
}
