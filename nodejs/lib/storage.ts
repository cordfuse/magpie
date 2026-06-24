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
  // dark (13)
  | 'oled'
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
  'oled',
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

// ─── Web search toggle (global, sticky across sessions) ─────────────────────
//
// One boolean stored in localStorage. v1 simplification: a single setting
// applies to whatever conversation is active. Avoids the "no conv id until
// after first send" chicken-and-egg. Per-conv override can come later.

const WEB_SEARCH_KEY = 'quill_web_search'

export function getWebSearchEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(WEB_SEARCH_KEY) === '1'
}

export function setWebSearchEnabled(enabled: boolean) {
  if (enabled) localStorage.setItem(WEB_SEARCH_KEY, '1')
  else localStorage.removeItem(WEB_SEARCH_KEY)
}

// ─── MCP server selection (per-user, persisted) ─────────────────────────────
//
// Set of server IDs the user has toggled on in the composer's MCP picker.
// Same model as web search: sticky across sessions, applies to the active
// conversation. Stored as a JSON array of strings.

const MCP_ENABLED_KEY = 'quill_mcp_enabled'

export function getEnabledMcps(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(MCP_ENABLED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch { return [] }
}

export function setEnabledMcps(ids: string[]) {
  if (ids.length === 0) localStorage.removeItem(MCP_ENABLED_KEY)
  else localStorage.setItem(MCP_ENABLED_KEY, JSON.stringify(ids))
}

// ─── Generation settings (user overrides — operator defaults via env) ────────
//
// All three are `null` when the user hasn't set them; in that case the server
// falls back to QUILL_SYSTEM_PROMPT / QUILL_TEMPERATURE / QUILL_MAX_TOKENS env
// vars, then to hardcoded defaults. Read/written as strings since localStorage
// is string-only — callers handle conversion.

const SYSTEM_PROMPT_KEY = 'quill_system_prompt'
const TEMPERATURE_KEY   = 'quill_temperature'

export function getCustomSystemPrompt(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SYSTEM_PROMPT_KEY)
}
export function setCustomSystemPrompt(s: string | null) {
  if (s && s.trim().length > 0) localStorage.setItem(SYSTEM_PROMPT_KEY, s)
  else localStorage.removeItem(SYSTEM_PROMPT_KEY)
}

export function getTemperature(): number | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(TEMPERATURE_KEY)
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export function setTemperature(t: number | null) {
  if (t === null) localStorage.removeItem(TEMPERATURE_KEY)
  else localStorage.setItem(TEMPERATURE_KEY, String(t))
}

// ─── Export / Import / Reset ─────────────────────────────────────────────────

export interface QuillExport {
  quill_export_version: 1
  exported_at: string
  conversations: Conversation[]
}

export function exportAll(): QuillExport {
  return {
    quill_export_version: 1,
    exported_at: new Date().toISOString(),
    conversations: loadConversations(),
  }
}

export interface ImportResult { imported: number; skipped: number; total: number }

export function importConversationsJson(json: string): ImportResult {
  const parsed = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid file')
  if (parsed.quill_export_version !== 1) throw new Error('Unsupported export version')
  if (!Array.isArray(parsed.conversations)) throw new Error('No conversations in file')

  const existing = loadConversations()
  const existingIds = new Set(existing.map(c => c.id))
  let imported = 0
  let skipped = 0
  for (const conv of parsed.conversations as Conversation[]) {
    if (!conv?.id || typeof conv.id !== 'string') { skipped++; continue }
    if (existingIds.has(conv.id)) { skipped++; continue }
    existing.push(conv)
    existingIds.add(conv.id)
    imported++
  }
  existing.sort((a, b) => b.updatedAt - a.updatedAt)
  saveConversations(existing)
  return { imported, skipped, total: parsed.conversations.length }
}

// Wipes every quill_* localStorage key (conversations, theme, provider, model,
// web search, generation settings, send key). Also drops the auth token +
// device id so the next session starts completely fresh.
export function resetAllData() {
  if (typeof window === 'undefined') return
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (k.startsWith('quill_') || k === 'auth_token' || k === 'device_id') toRemove.push(k)
  }
  for (const k of toRemove) localStorage.removeItem(k)
}
