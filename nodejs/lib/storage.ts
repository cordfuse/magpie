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

export function renameConversation(id: string, title: string) {
  const all = loadConversations()
  const idx = all.findIndex(c => c.id === id)
  if (idx < 0) return
  all[idx] = { ...all[idx], title, updatedAt: Date.now() }
  all.sort((a, b) => b.updatedAt - a.updatedAt)
  saveConversations(all)
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
// 24 popular developer themes (12 dark + 12 light). To add a theme: extend
// this union, add the id to VALID_THEMES below, add a `[data-theme="<id>"]`
// block in app/globals.css, and add the theme metadata to THEMES in
// app/page.tsx (plus the matching bootstrap script in app/layout.tsx).

export type Theme =
  // dark (12)
  | 'dracula'
  | 'one-dark'
  | 'tokyo-night'
  | 'nord'
  | 'solarized-dark'
  | 'gruvbox-dark'
  | 'monokai'
  | 'catppuccin-mocha'
  | 'night-owl'
  | 'synthwave'
  | 'github-dark'
  | 'palenight'
  // light (12)
  | 'solarized-light'
  | 'github-light'
  | 'catppuccin-latte'
  | 'one-light'
  | 'tokyo-night-light'
  | 'ayu-light'
  | 'gruvbox-light'
  | 'quiet-light'
  | 'light-plus'
  | 'material-lighter'
  | 'nord-light'
  | 'min-light'

const THEME_KEY = 'quill_theme'
const DEFAULT_THEME: Theme = 'dracula'

const VALID_THEMES = new Set<Theme>([
  // dark
  'dracula', 'one-dark', 'tokyo-night', 'nord', 'solarized-dark',
  'gruvbox-dark', 'monokai', 'catppuccin-mocha', 'night-owl',
  'synthwave', 'github-dark', 'palenight',
  // light
  'solarized-light', 'github-light', 'catppuccin-latte',
  'one-light', 'tokyo-night-light', 'ayu-light', 'gruvbox-light',
  'quiet-light', 'light-plus', 'material-lighter', 'nord-light', 'min-light',
])

export function getTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const stored = localStorage.getItem(THEME_KEY)
  // Guard against stale IDs from older theme palettes — fall back to the
  // default so a user with `quill_theme=tweed` (old guitar-amp palette)
  // doesn't end up with a broken UI after pulling the new themes.
  return stored && VALID_THEMES.has(stored as Theme) ? (stored as Theme) : DEFAULT_THEME
}

export function saveTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme)
}

// ─── Provider + model preferences ────────────────────────────────────────────
//
// Provider selection is a single string; model selection is per-provider
// (so switching back to Anthropic remembers you were on Sonnet, not Opus).
// Both fall back gracefully — server-side validates the selection and falls
// back to its registry default if anything's stale or unknown.

const PROVIDER_KEY = 'quill_provider'
const MODELS_KEY = 'quill_models'  // JSON map: { providerId: modelId }

export function getSelectedProvider(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(PROVIDER_KEY)
}

export function setSelectedProvider(provider: string) {
  localStorage.setItem(PROVIDER_KEY, provider)
}

function loadModelMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(MODELS_KEY) ?? '{}') } catch { return {} }
}

export function getSelectedModel(provider: string): string | null {
  return loadModelMap()[provider] ?? null
}

export function setSelectedModel(provider: string, model: string) {
  const map = loadModelMap()
  map[provider] = model
  localStorage.setItem(MODELS_KEY, JSON.stringify(map))
}
