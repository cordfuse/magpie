'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { v4 as uuidv4 } from 'uuid'
import { sendChatStream, initAuth, getProviders, getProviderModels, extractDocument, type AvailableProvider, type ProviderModel, type MultimodalMessage, type ContentBlock } from '@/lib/api'
import {
  loadConversations, upsertConversation, deleteConversation, renameConversation,
  clearAllConversations, autoTitle, relativeTime, getTheme, saveTheme, type Theme,
  getSelectedProvider, setSelectedProvider, getSelectedModel, setSelectedModel,
  getWebSearchEnabled, setWebSearchEnabled,
  getCustomSystemPrompt, setCustomSystemPrompt,
  getTemperature, setTemperature,
  getMaxTokens, setMaxTokens,
  getSendKey, setSendKey, type SendKey,
  exportAll, importConversationsJson, resetAllData,
} from '@/lib/storage'
import type { ChatMessage, Conversation, Attachment } from '@/lib/types'

// ─── theme palette ───────────────────────────────────────────────────────────
//
// 15 popular dev themes (12 dark + 3 light). Each entry carries the three
// preview colors used by the SettingsPanel dropdown swatches: bg, primary, fg.
// CSS for each lives in app/globals.css under `[data-theme="<id>"]`.
// To add a theme: extend the Theme union in lib/storage.ts, add the CSS
// block, add the VALID_THEMES set entry, and add an entry here.

interface ThemeMeta {
  id: Theme
  label: string
  desc: string
  bg: string
  primary: string
  fg: string
}

const THEMES: ThemeMeta[] = [
  // dark (13 — OLED first for the AMOLED-screen crowd)
  { id: 'oled',              label: 'OLED',             desc: 'Pure black',       bg: '#000000', primary: '#00bcd4', fg: '#e0e0e0' },
  { id: 'dracula',           label: 'Dracula',          desc: 'Purple night',     bg: '#282a36', primary: '#bd93f9', fg: '#f8f8f2' },
  { id: 'one-dark',          label: 'One Dark',         desc: 'Atom classic',     bg: '#282c34', primary: '#61afef', fg: '#abb2bf' },
  { id: 'tokyo-night',       label: 'Tokyo Night',      desc: 'Neon city',        bg: '#1a1b26', primary: '#7aa2f7', fg: '#c0caf5' },
  { id: 'nord',              label: 'Nord',             desc: 'Arctic',           bg: '#2e3440', primary: '#88c0d0', fg: '#eceff4' },
  { id: 'solarized-dark',    label: 'Solarized Dark',   desc: 'Ethan Schoonover', bg: '#002b36', primary: '#268bd2', fg: '#93a1a1' },
  { id: 'gruvbox-dark',      label: 'Gruvbox Dark',     desc: 'Retro warmth',     bg: '#282828', primary: '#fabd2f', fg: '#ebdbb2' },
  { id: 'monokai',           label: 'Monokai',          desc: 'TextMate roots',   bg: '#272822', primary: '#a6e22e', fg: '#f8f8f2' },
  { id: 'catppuccin-mocha',  label: 'Catppuccin Mocha', desc: 'Pastel night',     bg: '#1e1e2e', primary: '#cba6f7', fg: '#cdd6f4' },
  { id: 'night-owl',         label: 'Night Owl',        desc: 'Sarah Drasner',    bg: '#011627', primary: '#82aaff', fg: '#d6deeb' },
  { id: 'synthwave',         label: "Synthwave '84",    desc: 'Retro neon',       bg: '#262335', primary: '#ff7edb', fg: '#f4eee4' },
  { id: 'github-dark',       label: 'GitHub Dark',      desc: 'Official',         bg: '#0d1117', primary: '#58a6ff', fg: '#c9d1d9' },
  { id: 'palenight',         label: 'Palenight',        desc: 'Material',         bg: '#292d3e', primary: '#82aaff', fg: '#a6accd' },
  // light (12)
  { id: 'solarized-light',   label: 'Solarized Light',  desc: 'Ethan Schoonover', bg: '#fdf6e3', primary: '#268bd2', fg: '#586e75' },
  { id: 'github-light',      label: 'GitHub Light',     desc: 'Official',         bg: '#ffffff', primary: '#0969da', fg: '#1f2328' },
  { id: 'catppuccin-latte',  label: 'Catppuccin Latte', desc: 'Pastel day',       bg: '#eff1f5', primary: '#8839ef', fg: '#4c4f69' },
  { id: 'one-light',         label: 'One Light',        desc: 'Atom light',       bg: '#fafafa', primary: '#4078f2', fg: '#383a42' },
  { id: 'tokyo-night-light', label: 'Tokyo Night Light',desc: 'Day variant',      bg: '#d5d6db', primary: '#34548a', fg: '#343b58' },
  { id: 'ayu-light',         label: 'Ayu Light',        desc: 'Minimal warmth',   bg: '#fafafa', primary: '#ff8f40', fg: '#5c6166' },
  { id: 'gruvbox-light',     label: 'Gruvbox Light',    desc: 'Retro day',        bg: '#fbf1c7', primary: '#b57614', fg: '#3c3836' },
  { id: 'quiet-light',       label: 'Quiet Light',      desc: 'VS Code',          bg: '#f5f5f5', primary: '#4271ae', fg: '#333333' },
  { id: 'light-plus',        label: 'Light+',           desc: 'VS Code default',  bg: '#ffffff', primary: '#007acc', fg: '#000000' },
  { id: 'material-lighter',  label: 'Material Lighter', desc: 'Material light',   bg: '#fafafa', primary: '#6182b8', fg: '#546e7a' },
  { id: 'nord-light',        label: 'Nord Light',       desc: 'Snow + Frost',     bg: '#eceff4', primary: '#5e81ac', fg: '#2e3440' },
  { id: 'min-light',         label: 'Min Light',        desc: 'Minimal',          bg: '#fbfbfb', primary: '#2196f3', fg: '#222222' },
]

const THEME_GROUPS: { label: string; ids: Theme[] }[] = [
  { label: 'Dark',  ids: ['oled','dracula','one-dark','tokyo-night','nord','solarized-dark','gruvbox-dark','monokai','catppuccin-mocha','night-owl','synthwave','github-dark','palenight'] },
  { label: 'Light', ids: ['solarized-light','github-light','catppuccin-latte','one-light','tokyo-night-light','ayu-light','gruvbox-light','quiet-light','light-plus','material-lighter','nord-light','min-light'] },
]

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0'

// ─── icons ───────────────────────────────────────────────────────────────────

const QuillIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
    <path d="M20.5 3.5c-7 1-12 6-13.5 13.5L4 20l3-3.5c7.5-1.5 12.5-6.5 13.5-13z" />
    <path d="M4 20l8-8" />
  </svg>
)
const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
)
const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
)
const NewChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    <line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
  </svg>
)
const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
)
const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
)
const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
)
const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
)
const SearchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
)
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
)
const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
)
const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
)
const TrashSmIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
)
const EditMsgIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
)
const RefreshIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
)
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
)
const AttachIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
)
const CameraSmIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
)
const PhotoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
)
const DocumentIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
)

// ─── delete-confirm modal ────────────────────────────────────────────────────

function DeleteConfirmModal({ label, onConfirm, onCancel }: { label: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-fg">Delete {label}?</h3>
          <p className="text-xs text-fg-3">This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 text-xs text-fg-2 hover:text-fg transition-colors">Cancel</button>
            <button onClick={onConfirm} className="px-3 py-1.5 text-xs rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">Delete</button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── settings panel (right drawer) ───────────────────────────────────────────

function SettingsPanel({
  theme, onTheme,
  providers, selectedProvider, onProvider,
  customSystemPrompt, onSystemPrompt,
  customTemperature, onTemperature,
  customMaxTokens, onMaxTokens,
  sendKeyPref, onSendKey,
  onExport, onImport, onResetAll,
  onClose,
}: {
  theme: Theme
  onTheme: (t: Theme) => void
  providers: AvailableProvider[]
  selectedProvider: string
  onProvider: (p: string) => void
  customSystemPrompt: string | null
  onSystemPrompt: (s: string | null) => void
  customTemperature: number | null
  onTemperature: (t: number | null) => void
  customMaxTokens: number | null
  onMaxTokens: (t: number | null) => void
  sendKeyPref: SendKey
  onSendKey: (k: SendKey) => void
  onExport: () => void
  onImport: () => void
  onResetAll: () => void
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  // Local draft state for the system prompt textarea so the user can type
  // without each keystroke writing to localStorage. Commits on blur.
  const [promptDraft, setPromptDraft] = useState(customSystemPrompt ?? '')

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 240)
  }

  const active = THEMES.find(t => t.id === theme) ?? THEMES[0]
  const activeProvider = providers.find(p => p.id === selectedProvider) ?? providers[0]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={handleClose} />
      <aside className={`fixed right-0 top-0 z-50 flex h-full w-[min(20rem,100vw)] flex-col bg-surface shadow-2xl ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-medium text-fg">Settings</h2>
          <button onClick={handleClose} className="text-fg-3 hover:text-fg transition-colors" aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Theme */}
          <div>
            <p className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider mb-2">Theme</p>
            <div className="relative">
              <button
                onClick={() => setThemeOpen(o => !o)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-surface-2 px-3 py-2.5 text-sm text-fg hover:bg-surface-3 transition-colors"
              >
                <div className="flex gap-1 shrink-0">
                  <div style={{ background: active.bg }} className="h-3 w-3 rounded-sm border border-white/10" />
                  <div style={{ background: active.primary }} className="h-3 w-3 rounded-sm" />
                  <div style={{ background: active.fg, opacity: 0.7 }} className="h-3 w-3 rounded-sm" />
                </div>
                <span className="flex-1 text-left">{active.label}</span>
                <span className="text-[10px] text-fg-4 truncate max-w-[8rem]">{active.desc}</span>
                <ChevronIcon open={themeOpen} />
              </button>
              {themeOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setThemeOpen(false)} />
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden max-h-[60vh] overflow-y-auto">
                    {THEME_GROUPS.map(group => (
                      <div key={group.label}>
                        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-4 bg-surface">{group.label}</p>
                        {group.ids.map(id => {
                          const t = THEMES.find(x => x.id === id)
                          if (!t) return null
                          const isActive = theme === t.id
                          return (
                            <button
                              key={t.id}
                              onClick={() => { onTheme(t.id); setThemeOpen(false) }}
                              className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                isActive ? 'text-primary bg-primary/10' : 'text-fg-2 hover:bg-surface-3 hover:text-fg'
                              }`}
                            >
                              <div className="flex gap-1 shrink-0">
                                <div style={{ background: t.bg }} className="h-3 w-3 rounded-sm border border-white/10" />
                                <div style={{ background: t.primary }} className="h-3 w-3 rounded-sm" />
                                <div style={{ background: t.fg, opacity: 0.7 }} className="h-3 w-3 rounded-sm" />
                              </div>
                              <span className="flex-1 text-left">{t.label}</span>
                              <span className="text-[10px] opacity-50 truncate max-w-[6rem]">{t.desc}</span>
                              {isActive && <span className="ml-1 text-primary shrink-0">✓</span>}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Provider */}
          {providers.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider mb-2">Provider</p>
              <div className="relative">
                <button
                  onClick={() => setProviderOpen(o => !o)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-surface-2 px-3 py-2.5 text-sm text-fg hover:bg-surface-3 transition-colors"
                >
                  <span className="flex-1 text-left">{activeProvider?.label ?? selectedProvider}</span>
                  {activeProvider && !activeProvider.available && (
                    <span className="text-[10px] text-fg-4">key missing</span>
                  )}
                  <ChevronIcon open={providerOpen} />
                </button>
                {providerOpen && (() => {
                  const cloud = providers.filter(p => p.category === 'cloud')
                  const local = providers.filter(p => p.category === 'local')
                  const renderGroup = (label: string, items: typeof providers) => items.length > 0 && (
                    <div key={label}>
                      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-4 bg-surface">{label}</p>
                      {items.map(p => {
                        const isActive = selectedProvider === p.id
                        return (
                          <button
                            key={p.id}
                            onClick={() => { onProvider(p.id); setProviderOpen(false) }}
                            disabled={!p.available}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                              isActive ? 'text-primary bg-primary/10' : p.available ? 'text-fg-2 hover:bg-surface-3 hover:text-fg' : 'text-fg-4 cursor-not-allowed'
                            }`}
                          >
                            <span className="flex-1 text-left">{p.label}</span>
                            {!p.available && <span className="text-[10px] opacity-60">no key</span>}
                            {isActive && <span className="ml-1 text-primary shrink-0">✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  )
                  return (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setProviderOpen(false)} />
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden max-h-[60vh] overflow-y-auto">
                        {renderGroup('Cloud', cloud)}
                        {renderGroup('Local', local)}
                      </div>
                    </>
                  )
                })()}
              </div>
              {activeProvider && !activeProvider.available && activeProvider.category === 'cloud' && (
                <p className="mt-1.5 text-[10px] text-fg-4">
                  Set <code className="font-mono">{activeProvider.id.toUpperCase()}_API_KEY</code> in <code className="font-mono">.env.local</code> and restart the server.
                </p>
              )}
              {activeProvider && activeProvider.category === 'local' && (
                <p className="mt-1.5 text-[10px] text-fg-4">
                  Local server expected at the default port. Override with <code className="font-mono">{activeProvider.id.toUpperCase()}_BASE_URL</code> in <code className="font-mono">.env.local</code> if needed.
                </p>
              )}
            </div>
          )}

          {/* System prompt */}
          <div>
            <p className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider mb-2">System prompt</p>
            <textarea
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value)}
              onBlur={() => {
                const trimmed = promptDraft.trim()
                onSystemPrompt(trimmed.length > 0 ? trimmed : null)
              }}
              placeholder='Server default — set QUILL_SYSTEM_PROMPT in .env.local, or override per-user here.'
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-xs text-fg placeholder:text-fg-4 outline-none focus:ring-1 focus:ring-primary/40 resize-y min-h-[4.5rem]"
            />
            {customSystemPrompt && (
              <button
                onClick={() => { setPromptDraft(''); onSystemPrompt(null) }}
                className="mt-1 text-[10px] text-fg-4 hover:text-fg-2 transition-colors"
              >
                Clear override → use server default
              </button>
            )}
          </div>

          {/* Temperature */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider">Temperature</p>
              <span className="text-[10px] text-fg-4">
                {customTemperature !== null ? customTemperature.toFixed(2) : 'default'}
              </span>
            </div>
            <input
              type="range"
              min={0} max={2} step={0.05}
              value={customTemperature ?? 1}
              onChange={e => onTemperature(Number(e.target.value))}
              className="w-full accent-[color:var(--primary)]"
            />
            {customTemperature !== null && (
              <button
                onClick={() => onTemperature(null)}
                className="mt-1 text-[10px] text-fg-4 hover:text-fg-2 transition-colors"
              >
                Clear override → use server default
              </button>
            )}
          </div>

          {/* Max tokens */}
          <div>
            <p className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider mb-2">Max response tokens</p>
            <input
              type="number"
              min={1} max={32000} step={256}
              value={customMaxTokens ?? ''}
              onChange={e => {
                const v = e.target.value.trim()
                if (v === '') onMaxTokens(null)
                else { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) onMaxTokens(n) }
              }}
              placeholder="Server default"
              className="w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-xs text-fg placeholder:text-fg-4 outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* Send key */}
          <div>
            <p className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider mb-2">Send with</p>
            <div className="grid grid-cols-2 gap-2">
              {(['enter', 'mod-enter'] as const).map(k => {
                const isActive = sendKeyPref === k
                return (
                  <button
                    key={k}
                    onClick={() => onSendKey(k)}
                    className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                      isActive
                        ? 'border-primary/40 bg-primary/10 text-fg'
                        : 'border-white/10 bg-surface-2 text-fg-2 hover:bg-surface-3 hover:text-fg'
                    }`}
                  >
                    {k === 'enter' ? 'Enter' : '⌘/Ctrl + Enter'}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-[10px] text-fg-4">
              {sendKeyPref === 'enter'
                ? 'Shift+Enter for a new line'
                : 'Plain Enter for a new line'}
            </p>
          </div>

          {/* Data: Export / Import / Reset */}
          <div>
            <p className="text-[10px] font-semibold text-fg-3 uppercase tracking-wider mb-2">Data</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onExport}
                className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-xs text-fg-2 hover:bg-surface-3 hover:text-fg transition-colors"
              >
                Export…
              </button>
              <button
                onClick={onImport}
                className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-xs text-fg-2 hover:bg-surface-3 hover:text-fg transition-colors"
              >
                Import…
              </button>
            </div>
            <button
              onClick={onResetAll}
              className="mt-2 w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Reset all data
            </button>
          </div>
        </div>

        <div className="border-t border-white/10 px-5 py-3 flex items-center justify-between text-[10px] text-fg-4">
          <span>About</span>
          <span>Quill v{APP_VERSION}</span>
        </div>
      </aside>
    </>
  )
}

// ─── conversation list item ─────────────────────────────────────────────────

function ConvItem({ conv, active, onSelect, onDeleteRequest, onRename }: {
  conv: Conversation
  active: boolean
  onSelect: () => void
  onDeleteRequest: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(conv.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== conv.title) onRename(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={`relative flex items-center px-3 py-2 ${active ? 'bg-surface-2' : ''}`}>
        {active && <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-primary" />}
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') setEditing(false) }}
          className="flex-1 min-w-0 bg-transparent text-xs text-fg outline-none border-b border-primary py-0.5"
        />
      </div>
    )
  }

  return (
    <div
      className={`group relative flex items-center px-3 py-2.5 cursor-pointer transition-colors ${active ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
      onClick={onSelect}
    >
      {active && <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-primary" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-fg">{conv.title}</p>
        <p className="text-[10px] text-fg-4">{relativeTime(conv.updatedAt)}</p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); setName(conv.title); setEditing(true); requestAnimationFrame(() => inputRef.current?.focus()) }}
        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors"
        title="Rename"
      >
        <PencilIcon />
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDeleteRequest() }}
        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors"
        title="Delete"
      >
        <TrashIcon />
      </button>
    </div>
  )
}

// ─── sidebar (left drawer) ───────────────────────────────────────────────────

function Sidebar({
  visible, onClose, conversations, activeId, query, setQuery,
  onSelectConv, onDeleteConv, onRenameConv, onOpenSettings, onClearAll,
}: {
  visible: boolean
  onClose: () => void
  conversations: Conversation[]
  activeId: string | null
  query: string
  setQuery: (q: string) => void
  onSelectConv: (id: string) => void
  onDeleteConv: (id: string, title: string) => void
  onRenameConv: (id: string, title: string) => void
  onOpenSettings: () => void
  onClearAll: () => void
}) {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? conversations.filter(c => c.title.toLowerCase().includes(q) ||
        c.messages.some(m => m.content.toLowerCase().includes(q)))
    : conversations

  return (
    <>
      {visible && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />}
      <aside className={`
        fixed top-0 left-0 z-50 h-full bg-surface shadow-[4px_0_16px_rgba(0,0,0,0.35)]
        flex flex-col overflow-hidden transition-transform duration-200 w-[260px]
        lg:relative lg:shadow-none
        ${visible ? 'translate-x-0' : '-translate-x-full lg:w-0'}
      `}>
        {/* brand + close (mobile) */}
        <div className="flex items-center justify-between px-3 py-3 shrink-0 min-w-[260px]">
          <div className="flex items-center gap-2.5">
            <QuillIcon />
            <span className="text-sm font-medium text-fg whitespace-nowrap">Quill</span>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg transition-colors lg:hidden" aria-label="Close sidebar">
            <CloseIcon />
          </button>
        </div>

        {/* tabs-row equivalent — mighty puts Delete-all-chats here, right-aligned, under a thin divider. Quill has no tabs, so the row is just label + clear-all */}
        <div className="flex items-center border-b border-white/10 ml-3 mr-[17px] h-9">
          <span className="text-xs font-medium text-fg-3">Chats</span>
          <div className="flex-1" />
          {conversations.length > 0 && (
            <button
              onClick={onClearAll}
              title="Clear all conversations"
              aria-label="Clear all conversations"
              className="flex h-7 w-7 items-center justify-center text-fg-4 hover:text-red-400 transition-colors"
            >
              <TrashIcon />
            </button>
          )}
        </div>

        {/* search */}
        <div className="px-3 pt-2 pb-2 shrink-0 min-w-[260px]">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-4 pointer-events-none"><SearchIcon /></span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-lg bg-surface-2 py-1.5 pl-7 pr-7 text-xs text-fg placeholder:text-fg-4 outline-none focus:ring-1 focus:ring-primary/40"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-4 hover:text-fg-2 transition-colors" aria-label="Clear search">
                <CloseIcon />
              </button>
            )}
          </div>
        </div>

        {/* conv list */}
        <div className="flex-1 overflow-y-auto py-1 [scrollbar-gutter:stable]">
          {filtered.length === 0
            ? <p className="px-4 py-6 text-center text-[11px] text-fg-4">{q ? 'No matches' : 'No conversations yet'}</p>
            : filtered.map(conv => (
              <ConvItem
                key={conv.id}
                conv={conv}
                active={conv.id === activeId}
                onSelect={() => { onSelectConv(conv.id); onClose() }}
                onDeleteRequest={() => onDeleteConv(conv.id, conv.title)}
                onRename={name => onRenameConv(conv.id, name)}
              />
            ))
          }
        </div>

        {/* footer: settings shortcut */}
        <div className="shrink-0 min-w-[260px] border-t border-white/10 px-3 py-2 flex items-center">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-fg-3 hover:text-fg transition-colors"
            title="Settings"
          >
            <GearIcon /> Settings
          </button>
        </div>
      </aside>
    </>
  )
}

// ─── message bubble ──────────────────────────────────────────────────────────

function MessageItem({ msg, streaming, isLastAssistant, onEditAndResend, onRegenerate }: {
  msg: ChatMessage
  streaming: boolean
  isLastAssistant: boolean
  onEditAndResend: (id: string, newContent: string) => void
  onRegenerate: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(msg.content)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  const copy = () => {
    navigator.clipboard.writeText(msg.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const startEdit = () => {
    setDraft(msg.content)
    setEditing(true)
    requestAnimationFrame(() => {
      const el = editTextareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    })
  }
  const cancelEdit = () => { setEditing(false); setDraft(msg.content) }
  const saveEdit = () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === msg.content) { cancelEdit(); return }
    setEditing(false)
    onEditAndResend(msg.id, trimmed)
  }

  if (msg.role === 'user') {
    const actions = !editing && !streaming && (
      <div
        className="flex gap-2 opacity-60 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity mb-1"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={copy} title={copied ? 'Copied' : 'Copy'} className="text-fg-4 hover:text-fg-2 transition-colors">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <button onClick={startEdit} title="Edit & resend" className="text-fg-4 hover:text-fg-2 transition-colors">
          <EditMsgIcon />
        </button>
      </div>
    )
    return (
      <div className="group flex items-end justify-end gap-1.5">
        {actions}
        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-primary/40 bg-surface p-2">
            <textarea
              ref={editTextareaRef}
              value={draft}
              onChange={e => {
                setDraft(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 200) + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
              }}
              className="w-full resize-none bg-transparent text-sm text-fg outline-none px-2 pt-1"
              style={{ minHeight: '2rem', maxHeight: '200px' }}
            />
            <div className="flex items-center justify-end gap-2 px-1 pt-1">
              <button onClick={cancelEdit} className="px-2.5 py-1 text-xs text-fg-3 hover:text-fg transition-colors">Cancel</button>
              <button
                onClick={saveEdit}
                disabled={!draft.trim() || draft.trim() === msg.content}
                className="px-2.5 py-1 text-xs rounded-lg bg-primary text-on-primary hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-on-primary whitespace-pre-wrap break-words space-y-2">
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {msg.attachments.map((att, i) => att.kind === 'image' && att.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={att.dataUrl} alt={att.name} className="max-h-40 rounded-lg border border-white/10 object-cover" />
                ) : (
                  <div key={i} className="flex items-center gap-2 rounded-md bg-on-primary/10 px-2 py-1 text-[11px]">
                    <DocumentIcon /> {att.name}
                  </div>
                ))}
              </div>
            )}
            {msg.content && <div>{msg.content}</div>}
          </div>
        )}
      </div>
    )
  }

  const isEmptyStreaming = msg.content.length === 0 && streaming
  // Regenerate is only offered on the LAST assistant message, and only
  // when we're not currently streaming (otherwise it's mid-flight).
  const actions = !isEmptyStreaming && (
    <div
      className="flex gap-2 opacity-60 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity mb-1"
      onClick={e => e.stopPropagation()}
    >
      <button onClick={copy} title={copied ? 'Copied' : 'Copy'} className="text-fg-4 hover:text-fg-2 transition-colors">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      {isLastAssistant && !streaming && (
        <button onClick={onRegenerate} title="Regenerate response" className="text-fg-4 hover:text-fg-2 transition-colors">
          <RefreshIcon />
        </button>
      )}
    </div>
  )

  return (
    <div className="group flex flex-col items-start gap-0.5">
      <div className="flex items-end gap-1.5 max-w-full">
        <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-sm text-fg">
          {isEmptyStreaming ? (
            <span className="inline-flex gap-1 items-end h-4">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-3" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-3" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-3" />
            </span>
          ) : (
            <div className="prose prose-sm max-w-none [&>*]:my-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:text-primary [&_a]:underline [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-surface-2 [&_pre]:bg-surface-2 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          )}
        </div>
        {actions}
      </div>
      {msg.sources && msg.sources.length > 0 && (
        <div className="ml-1 mt-1 max-w-[85%] rounded-xl bg-surface px-3 py-2 border-l border-primary/30">
          <div className="text-[10px] text-fg-3 mb-1 uppercase tracking-wider">Sources</div>
          <ul className="space-y-1.5">
            {msg.sources.map((s, i) => {
              let host = ''
              try { host = new URL(s.url).hostname } catch { /* malformed URL — skip favicon */ }
              return (
                <li key={i} className="flex items-center gap-2 text-xs">
                  {host && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                      alt=""
                      width={16}
                      height={16}
                      className="shrink-0 rounded-sm"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                    />
                  )}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-0 truncate text-primary hover:underline"
                    title={s.url}
                  >
                    {s.title || host || s.url}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Home({ initialConvId }: { initialConvId?: string } = {}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sidebar visibility: default collapsed on mobile, open on lg+ (CSS handles
  // the lg:relative override; we just track the boolean).
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>('dracula')
  const [confirmDelete, setConfirmDelete] = useState<{ label: string; doDelete: () => void } | null>(null)
  const [search, setSearch] = useState('')
  const [providers, setProviders] = useState<AvailableProvider[]>([])
  const [webSearchAvailable, setWebSearchAvailable] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [toolRunning, setToolRunning] = useState<{ name: string; query?: string } | null>(null)
  // Generation settings: null = use server default. UI shows a placeholder
  // hint when unset so user knows what value will actually be used.
  const [customSystemPrompt, setCustomSystemPromptState] = useState<string | null>(null)
  const [customTemperature, setCustomTemperatureState] = useState<number | null>(null)
  const [customMaxTokens, setCustomMaxTokensState] = useState<number | null>(null)
  const [sendKeyPref, setSendKeyPrefState] = useState<SendKey>('enter')
  const [provider, setProviderState] = useState<string>('anthropic')
  const [model, setModelState] = useState<string>('claude-sonnet-4-6')
  const [modelOpen, setModelOpen] = useState(false)
  // Live model list per provider id — populated lazily when the dropdown
  // opens. For local providers this is the actual installed-models list
  // returned by the local server's /v1/models endpoint.
  const [liveModels, setLiveModels] = useState<Record<string, ProviderModel[]>>({})
  const [liveModelsLoading, setLiveModelsLoading] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const photosInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const importJsonRef = useRef<HTMLInputElement>(null)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const initialized = useRef(false)

  // ── init ──
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const t = getTheme()
    setTheme(t)
    document.documentElement.setAttribute('data-theme', t)
    const loaded = loadConversations()
    setConversations(loaded)
    // Generation prefs + send-key from localStorage.
    setCustomSystemPromptState(getCustomSystemPrompt())
    setCustomTemperatureState(getTemperature())
    setCustomMaxTokensState(getMaxTokens())
    setSendKeyPrefState(getSendKey())
    // Hydrate the active conversation from the URL (e.g. /c/<id> hard load).
    // If the id doesn't exist anymore (deleted on another tab, stale link),
    // silently fall back to / so the user sees the empty state.
    if (initialConvId) {
      const conv = loaded.find(c => c.id === initialConvId)
      if (conv) {
        setActiveId(conv.id)
        setMessages(conv.messages)
      } else if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/')
      }
    }
    // open sidebar by default on wide screens
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarOpen(true)
    }
    // Back/forward navigation handler — when the URL changes via the
    // browser's history (popstate), reload the matching conversation
    // without remounting Home.
    const onPop = () => {
      const path = window.location.pathname
      const m = path.match(/^\/c\/([^/]+)\/?$/)
      if (m) {
        const id = m[1]
        const conv = loadConversations().find(c => c.id === id)
        if (conv) {
          setActiveId(id)
          setMessages(conv.messages)
          return
        }
      }
      // Not on a conv route — reset to empty.
      setActiveId(null)
      setMessages([])
    }
    window.addEventListener('popstate', onPop)
    // No cleanup needed — initialized.current guard prevents re-binding.
    // Auth, then load providers. The provider list endpoint requires auth,
    // so we sequence rather than parallel.
    void (async () => {
      try {
        await initAuth()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Auth failed')
        return
      }
      try {
        const { providers: list, features } = await getProviders()
        setProviders(list)
        setWebSearchAvailable(!!features.webSearch)
        // Only honor the stored toggle if the operator actually has search
        // available — otherwise it'd be on but silently broken.
        if (features.webSearch) setWebSearch(getWebSearchEnabled())
        // Resolve initial provider: stored choice (if still valid + available)
        // → first available → first in list. Then resolve model the same way.
        const stored = getSelectedProvider()
        const storedIsValid = stored && list.some(p => p.id === stored && p.available)
        const firstAvailable = list.find(p => p.available)
        const chosen = storedIsValid ? stored! : (firstAvailable?.id ?? list[0]?.id ?? 'anthropic')
        setProviderState(chosen)
        const chosenInfo = list.find(p => p.id === chosen)
        const storedModel = getSelectedModel(chosen)
        const storedModelValid = storedModel && chosenInfo?.models.some(m => m.id === storedModel)
        setModelState(storedModelValid ? storedModel! : (chosenInfo?.defaultModel ?? 'claude-sonnet-4-6'))
      } catch (e) {
        console.error('providers fetch failed:', e)
      }
    })()
  }, [])

  const handleWebSearch = useCallback((on: boolean) => {
    setWebSearch(on)
    setWebSearchEnabled(on)
  }, [])

  const handleSystemPrompt = useCallback((s: string | null) => {
    setCustomSystemPromptState(s)
    setCustomSystemPrompt(s)
  }, [])
  const handleTemperature = useCallback((t: number | null) => {
    setCustomTemperatureState(t)
    setTemperature(t)
  }, [])
  const handleMaxTokens = useCallback((t: number | null) => {
    setCustomMaxTokensState(t)
    setMaxTokens(t)
  }, [])
  const handleSendKey = useCallback((k: SendKey) => {
    setSendKeyPrefState(k)
    setSendKey(k)
  }, [])

  // ── auto-scroll on new content ──
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  // ── auto-resize textarea ──
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  // ── handlers ──
  const handleTheme = useCallback((t: Theme) => {
    setTheme(t)
    saveTheme(t)
    document.documentElement.setAttribute('data-theme', t)
  }, [])

  const handleProvider = useCallback((p: string) => {
    setProviderState(p)
    setSelectedProvider(p)
    // Restore the user's last-used model for the new provider, else its default.
    const info = providers.find(x => x.id === p)
    if (!info) return
    const stored = getSelectedModel(p)
    const storedValid = stored && info.models.some(m => m.id === stored)
    setModelState(storedValid ? stored! : info.defaultModel)
  }, [providers])

  const handleModel = useCallback((m: string) => {
    setModelState(m)
    setSelectedModel(provider, m)
  }, [provider])

  // URL sync helper. Soft-update only (history.replaceState) — we never
  // re-mount Home for in-app navigation, only on hard refresh / shared
  // link / browser back-forward. Keeps drafts, sidebar state, etc intact.
  const updateUrl = useCallback((convId: string | null) => {
    if (typeof window === 'undefined') return
    const target = convId ? `/c/${convId}` : '/'
    if (window.location.pathname === target) return
    window.history.replaceState(null, '', target)
  }, [])

  const newConversation = useCallback(() => {
    setActiveId(null)
    setMessages([])
    setError(null)
    setInput('')
    updateUrl(null)
  }, [updateUrl])

  const loadConversation = useCallback((id: string) => {
    const conv = conversations.find(c => c.id === id)
    if (!conv) return
    setActiveId(id)
    setMessages(conv.messages)
    setError(null)
    updateUrl(id)
  }, [conversations, updateUrl])

  const removeConversation = useCallback((id: string) => {
    deleteConversation(id)
    setConversations(loadConversations())
    if (activeId === id) {
      setActiveId(null)
      setMessages([])
      updateUrl(null)
    }
  }, [activeId, updateUrl])

  const handleRename = useCallback((id: string, title: string) => {
    renameConversation(id, title)
    setConversations(loadConversations())
  }, [])

  // Build the wire-format messages array (multimodal content where needed)
  // from the in-memory ChatMessage[]. Shared by send/edit/regenerate.
  const buildWireMessages = useCallback((msgs: ChatMessage[]): MultimodalMessage[] =>
    msgs.map(m => {
      if (m.attachments && m.attachments.length > 0) {
        // Document attachments inject their extracted text as a prefix into
        // the user's prompt — every provider can read it as plain text, no
        // multimodal capability required. Images go in as image_url blocks
        // (multimodal-capable providers only; token.js routes the format).
        const docPrefixes: string[] = []
        const imageBlocks: ContentBlock[] = []
        for (const att of m.attachments) {
          if (att.kind === 'document' && att.extractedText) {
            docPrefixes.push(`[Attached document: ${att.name}]\n${att.extractedText}`)
          } else if (att.kind === 'image' && att.dataUrl) {
            imageBlocks.push({ type: 'image_url', image_url: { url: att.dataUrl } })
          }
        }
        const combinedText = [...docPrefixes, m.content].filter(Boolean).join('\n\n---\n\n')
        // If we only have text (docs + typed prompt, no images), keep
        // content as a plain string so non-multimodal providers (e.g.
        // perplexity, ai21) don't choke on the content array.
        if (imageBlocks.length === 0) return { role: m.role, content: combinedText }
        const blocks: ContentBlock[] = []
        if (combinedText) blocks.push({ type: 'text', text: combinedText })
        blocks.push(...imageBlocks)
        return { role: m.role, content: blocks }
      }
      return { role: m.role, content: m.content }
    }),
  [])

  const clearAll = useCallback(() => {
    clearAllConversations()
    setConversations([])
    setActiveId(null)
    setMessages([])
    updateUrl(null)
  }, [updateUrl])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  // ── attachment handlers ──
  // MIME types we can extract text from purely client-side via FileReader.
  // Anything outside this list (currently just PDF in practice) goes to the
  // /api/extract-document endpoint for server-side handling.
  const isClientTextType = (mime: string, name: string) => {
    if (mime.startsWith('text/')) return true
    if (['application/json', 'application/xml', 'application/x-yaml'].includes(mime)) return true
    return /\.(txt|md|json|csv|xml|html?|rtf|yaml|yml|log)$/i.test(name)
  }

  const onPickFile = useCallback((kind: Attachment['kind']) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''  // allow re-selecting the same file later
    if (!f) return
    // Cap to ~5MB per file to keep base64 payloads sane.
    if (f.size > 5 * 1024 * 1024) {
      setError(`Attachment "${f.name}" is too large (max 5 MB).`)
      return
    }

    if (kind === 'image') {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(f)
      }).catch(() => undefined)
      setPendingAttachments(prev => [...prev, {
        kind: 'image', name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, dataUrl,
      }])
      return
    }

    // Document: insert a placeholder chip immediately (so the user sees
    // something happen), then extract in the background and patch the
    // attachment in place when done.
    const mimeType = f.type || 'application/octet-stream'
    const placeholder: Attachment = {
      kind: 'document', name: f.name, mimeType, size: f.size, extracting: true,
    }
    setPendingAttachments(prev => [...prev, placeholder])
    const idxKey = f.name + ':' + f.size  // unique-ish key to find it later

    const patch = (updates: Partial<Attachment>) => {
      setPendingAttachments(prev => prev.map(a =>
        (a.name + ':' + a.size === idxKey && a.extracting) ? { ...a, ...updates, extracting: false } : a
      ))
    }

    try {
      let text: string
      if (isClientTextType(mimeType, f.name)) {
        text = await f.text()
      } else {
        // Need server extraction (PDF, etc). Read as base64 data URL, strip
        // the prefix, ship to /api/extract-document.
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(f)
        })
        const dataBase64 = dataUrl.split(',', 2)[1] ?? ''
        text = await extractDocument(f.name, mimeType, dataBase64)
      }
      patch({ extractedText: text })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Extraction failed'
      patch({ extractError: msg })
      setError(`Couldn't extract "${f.name}": ${msg}`)
    }
  }, [])

  const removePendingAttachment = useCallback((idx: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== idx))
  }, [])

  // Core chat-run flow. Takes a fully-prepared messages array (ending with a
  // user turn). Pushes an empty assistant placeholder, streams the response
  // into it, persists. Shared by send, editAndResend, regenerate.
  const runFlowWith = useCallback(async (newMessages: ChatMessage[]) => {
    setMessages(newMessages)
    setError(null)
    setStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    const assistantId = uuidv4()
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '' }
    setMessages([...newMessages, assistantMsg])

    const wireMessages = buildWireMessages(newMessages)

    try {
      const res = await sendChatStream(
        wireMessages,
        delta => {
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m
          ))
        },
        abort.signal,
        {
          provider, model, webSearch,
          systemPrompt: customSystemPrompt ?? undefined,
          temperature: customTemperature ?? undefined,
          maxTokens: customMaxTokens ?? undefined,
        },
        {
          onToolRunning: info => setToolRunning(info),
          onSources: sources => {
            setToolRunning(null)
            setMessages(prev => prev.map(m =>
              m.id === assistantId
                ? { ...m, sources: [...(m.sources ?? []), ...sources] }
                : m
            ))
          },
        },
      )
      const finalAssistant: ChatMessage = {
        id: assistantId, role: 'assistant', content: res.message, sources: res.sources,
      }
      const finalMessages = [...newMessages, finalAssistant]
      setMessages(finalMessages)

      const convId = activeId ?? uuidv4()
      const now = Date.now()
      const existing = conversations.find(c => c.id === convId)
      const conv: Conversation = {
        id: convId,
        title: existing?.title ?? autoTitle(finalMessages),
        messages: finalMessages,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      upsertConversation(conv)
      setConversations(loadConversations())
      if (!activeId) {
        setActiveId(convId)
        updateUrl(convId)
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setMessages(prev => prev.filter(m => m.id !== assistantId || m.content.length > 0))
      } else {
        const msg = e instanceof Error ? e.message : 'Request failed'
        setError(msg)
        setMessages(prev => prev.filter(m => m.id !== assistantId || m.content.length > 0))
      }
    } finally {
      setStreaming(false)
      setToolRunning(null)
      abortRef.current = null
    }
  }, [activeId, conversations, provider, model, webSearch, customSystemPrompt, customTemperature, customMaxTokens, buildWireMessages, updateUrl])

  const send = useCallback(async () => {
    const text = input.trim()
    if ((!text && pendingAttachments.length === 0) || streaming) return

    // Don't send while any document is still being extracted, or if any
    // failed extraction.
    const stillExtracting = pendingAttachments.some(a => a.extracting)
    if (stillExtracting) {
      setError("Wait — still extracting one or more attached documents.")
      return
    }
    const failed = pendingAttachments.find(a => a.extractError)
    if (failed) {
      setError(`Can't send: extraction failed for "${failed.name}". Remove it to continue.`)
      return
    }

    const attachments = pendingAttachments.slice()
    const userMsg: ChatMessage = {
      id: uuidv4(), role: 'user', content: text,
      attachments: attachments.length > 0 ? attachments : undefined,
    }
    setInput('')
    setPendingAttachments([])
    await runFlowWith([...messages, userMsg])
  }, [input, streaming, messages, pendingAttachments, runFlowWith])

  // Edit-and-resend: replace the chosen user message's content, drop every
  // message after it (the now-stale assistant response and any downstream
  // turns), and re-run the chat. Mirrors Claude.ai / ChatGPT semantics.
  const editAndResend = useCallback(async (msgId: string, newContent: string) => {
    if (streaming) return
    const idx = messages.findIndex(m => m.id === msgId)
    if (idx < 0 || messages[idx].role !== 'user') return
    const editedMsg: ChatMessage = { ...messages[idx], id: uuidv4(), content: newContent }
    await runFlowWith([...messages.slice(0, idx), editedMsg])
  }, [messages, streaming, runFlowWith])

  // Regenerate: drop the last (assistant) message and re-run with the same
  // user prompt that produced it.
  const regenerate = useCallback(async () => {
    if (streaming || messages.length === 0) return
    const last = messages[messages.length - 1]
    if (last.role !== 'assistant') return
    await runFlowWith(messages.slice(0, -1))
  }, [messages, streaming, runFlowWith])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (sendKeyPref === 'mod-enter') {
      // Cmd/Ctrl+Enter sends; plain Enter inserts a newline.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        send()
      }
      return
    }
    // Default: Enter sends, Shift+Enter inserts a newline.
    if (!e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // ── render ──
  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        query={search}
        setQuery={setSearch}
        onSelectConv={loadConversation}
        onDeleteConv={(id, title) => setConfirmDelete({ label: `"${title}"`, doDelete: () => removeConversation(id) })}
        onRenameConv={handleRename}
        onOpenSettings={() => { setSettingsOpen(true); setSidebarOpen(false) }}
        onClearAll={() => setConfirmDelete({
          label: `all ${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`,
          doDelete: clearAll,
        })}
      />

      {/* main column */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg">
        <header className="quill-header px-3 py-3 flex items-center gap-2 shrink-0 bg-surface z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-3 hover:bg-surface hover:text-fg transition-colors"
            title="Open chats"
            aria-label="Open chats"
          >
            <MenuIcon />
          </button>
          <h1 className="text-sm font-medium text-fg">Quill</h1>
          <div className="flex-1" />
          {activeId && (
            <button
              onClick={() => {
                const conv = conversations.find(c => c.id === activeId)
                if (!conv) return
                setConfirmDelete({
                  label: `"${conv.title}"`,
                  doDelete: () => { removeConversation(activeId); newConversation() },
                })
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-3 hover:bg-surface hover:text-red-400 transition-colors"
              title="Delete chat"
              aria-label="Delete current chat"
            >
              <TrashIcon />
            </button>
          )}
          <button
            onClick={newConversation}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-3 hover:bg-surface hover:text-fg transition-colors"
            title="New chat"
            aria-label="New chat"
          >
            <NewChatIcon />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-3 hover:bg-surface hover:text-fg transition-colors"
            title="Settings"
            aria-label="Open settings"
          >
            <GearIcon />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-16 text-fg-4 text-sm">
                Start a conversation.
              </div>
            )}
            {messages.map(m => (
              <MessageItem
                key={m.id}
                msg={m}
                streaming={streaming}
                isLastAssistant={m.role === 'assistant' && m.id === messages[messages.length - 1]?.id}
                onEditAndResend={editAndResend}
                onRegenerate={regenerate}
              />
            ))}
          </div>
        </div>

        {/* error banner */}
        {error && (
          <div className="relative mx-4 mb-2 rounded-xl border px-4 py-2.5 pr-8" style={{ background: 'var(--error-bg)', borderColor: 'var(--error-border)' }}>
            <button onClick={() => setError(null)} className="absolute top-2.5 right-2.5 hover:opacity-100" style={{ color: 'var(--error-fg)' }} aria-label="Dismiss error"><CloseIcon /></button>
            <span className="text-sm" style={{ color: 'var(--error-fg)' }}>{error}</span>
          </div>
        )}

        {/* tool-running banner — shown while the model is calling a tool mid-stream */}
        {toolRunning && (
          <div className="mx-4 mb-2 rounded-xl border border-white/10 bg-surface px-3 py-2 flex items-center gap-2 text-xs text-fg-2 animate-fade-in">
            <span className="text-primary"><GlobeIcon /></span>
            <span>Searching{toolRunning.query ? `: ${toolRunning.query}` : '…'}</span>
            <span className="text-fg-4 animate-pulse">·</span>
          </div>
        )}

        {/* composer */}
        <div className="px-4 pb-4 pt-2 shrink-0">
          {/* hidden file inputs */}
          <input ref={cameraInputRef}   type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickFile('image')} />
          <input ref={photosInputRef}   type="file" accept="image/*"                         className="hidden" onChange={onPickFile('image')} />
          <input ref={documentInputRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.json,.csv,.xml,.html,.htm,.rtf,.yaml,.yml,.log" className="hidden" onChange={onPickFile('document')} />

          <div className="max-w-3xl mx-auto rounded-3xl border border-white/10 bg-surface transition-colors focus-within:border-primary/40">
            {/* pending attachment chips (above the textarea) */}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                {pendingAttachments.map((att, idx) => (
                  <div
                    key={idx}
                    className={`group flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                      att.extractError ? 'border-red-400/40 bg-red-500/10 text-red-300' : 'border-white/10 bg-surface-2 text-fg-2'
                    }`}
                  >
                    {att.kind === 'image' && att.dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={att.dataUrl} alt={att.name} className="h-6 w-6 rounded object-cover" />
                    ) : (
                      <span className="text-fg-4"><DocumentIcon /></span>
                    )}
                    <span className="truncate max-w-[10rem]" title={att.extractError ?? att.name}>{att.name}</span>
                    {att.extracting && <span className="text-[10px] text-fg-4 animate-pulse">extracting…</span>}
                    {att.extractedText && att.kind === 'document' && (
                      <span className="text-[10px] text-fg-4">{Math.round(att.extractedText.length / 1024)}k chars</span>
                    )}
                    {att.extractError && <span className="text-[10px]">failed</span>}
                    <button
                      onClick={() => removePendingAttachment(idx)}
                      title="Remove"
                      className="text-fg-4 hover:text-red-400 transition-colors"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Send a message…"
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-fg placeholder:text-fg-4 outline-none disabled:opacity-50"
              style={{ maxHeight: '160px', overflowY: 'auto' }}
              disabled={streaming}
            />
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
              {/* attach button + model pill on the left */}
              <div className="flex items-center gap-1.5">
                {/* attach button */}
                <div className="relative">
                  <button
                    onClick={() => setAttachMenuOpen(o => !o)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg transition-colors"
                    title="Attach"
                    aria-label="Attach a file"
                  >
                    <AttachIcon />
                  </button>
                  {attachMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setAttachMenuOpen(false)} />
                      <div className="absolute left-0 bottom-full z-40 mb-1 min-w-[10rem] rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden">
                        <button
                          onClick={() => { setAttachMenuOpen(false); cameraInputRef.current?.click() }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-fg-2 hover:bg-surface-3 hover:text-fg transition-colors"
                        >
                          <CameraSmIcon /> Camera
                        </button>
                        <button
                          onClick={() => { setAttachMenuOpen(false); photosInputRef.current?.click() }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-fg-2 hover:bg-surface-3 hover:text-fg transition-colors"
                        >
                          <PhotoIcon /> Photos
                        </button>
                        <button
                          onClick={() => { setAttachMenuOpen(false); documentInputRef.current?.click() }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-fg-2 hover:bg-surface-3 hover:text-fg transition-colors"
                        >
                          <DocumentIcon /> Documents
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {/* Web search toggle — only when the server has TAVILY_API_KEY */}
                {webSearchAvailable && (
                  <button
                    onClick={() => handleWebSearch(!webSearch)}
                    title={webSearch ? 'Web search: ON — click to turn off' : 'Web search: off — click to turn on'}
                    aria-label="Toggle web search"
                    aria-pressed={webSearch}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      webSearch
                        ? 'text-primary bg-primary/15 hover:bg-primary/25'
                        : 'text-fg-3 hover:bg-surface-2 hover:text-fg'
                    }`}
                  >
                    <GlobeIcon />
                  </button>
                )}
              {/* Model pill — opens upward from the composer */}
              <div>
                {providers.length > 0 && (() => {
                  const providerInfo = providers.find(p => p.id === provider)
                  if (!providerInfo) return null
                  // Live-discovered models trump the curated registry list
                  // (matters for local providers: we can't know what the
                  // operator has actually installed without probing).
                  const modelsForDropdown = liveModels[providerInfo.id] ?? providerInfo.models
                  const allKnownModels = [...providerInfo.models, ...(liveModels[providerInfo.id] ?? [])]
                  const modelInfo = allKnownModels.find(m => m.id === model)
                  const openDropdown = async () => {
                    setModelOpen(o => !o)
                    if (modelOpen) return  // we're closing it
                    if (providerInfo.category === 'local' && !liveModels[providerInfo.id]) {
                      setLiveModelsLoading(true)
                      try {
                        const res = await getProviderModels(providerInfo.id)
                        setLiveModels(prev => ({ ...prev, [providerInfo.id]: res.models }))
                      } catch (e) {
                        console.warn('live models fetch failed:', e)
                      } finally {
                        setLiveModelsLoading(false)
                      }
                    }
                  }
                  return (
                    <div className="relative">
                      <button
                        onClick={openDropdown}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-surface-2 px-2.5 py-1.5 text-xs text-fg-2 hover:bg-surface-3 hover:text-fg transition-colors"
                        title={`${providerInfo.label} — change model`}
                      >
                        <span className="truncate max-w-[10rem]">{modelInfo?.label ?? model}</span>
                        <ChevronIcon open={modelOpen} />
                      </button>
                      {modelOpen && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setModelOpen(false)} />
                          <div className="absolute left-0 bottom-full z-40 mb-1 min-w-[14rem] rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden max-h-[50vh] overflow-y-auto">
                            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-4 bg-surface flex items-center justify-between">
                              <span>{providerInfo.label}</span>
                              {providerInfo.category === 'local' && liveModelsLoading && <span className="text-fg-4">…</span>}
                            </p>
                            {modelsForDropdown.length === 0 ? (
                              <p className="px-3 py-3 text-[11px] text-fg-4">
                                {providerInfo.category === 'local'
                                  ? 'No models installed. Pull or load one on the server.'
                                  : 'No models available.'}
                              </p>
                            ) : modelsForDropdown.map(m => {
                              const isActive = model === m.id
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => { handleModel(m.id); setModelOpen(false) }}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors ${
                                    isActive ? 'text-primary bg-primary/10' : 'text-fg-2 hover:bg-surface-3 hover:text-fg'
                                  }`}
                                >
                                  <span className="flex-1 text-left">{m.label}</span>
                                  {isActive && <span className="text-primary shrink-0">✓</span>}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })()}
              </div>
              </div>
              {streaming ? (
                <button
                  onClick={stop}
                  title="Stop"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-on-primary hover:opacity-90 transition-opacity"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim() && pendingAttachments.length === 0}
                  title="Send"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-on-primary hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* hidden import file input — triggered by Settings "Import…" button */}
      <input
        ref={importJsonRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            const text = await f.text()
            const res = importConversationsJson(text)
            setConversations(loadConversations())
            setError(`Imported ${res.imported} conversation${res.imported === 1 ? '' : 's'} (${res.skipped} skipped as duplicates or invalid).`)
          } catch (err) {
            setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
          }
        }}
      />

      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          onTheme={handleTheme}
          providers={providers}
          selectedProvider={provider}
          onProvider={handleProvider}
          customSystemPrompt={customSystemPrompt}
          onSystemPrompt={handleSystemPrompt}
          customTemperature={customTemperature}
          onTemperature={handleTemperature}
          customMaxTokens={customMaxTokens}
          onMaxTokens={handleMaxTokens}
          sendKeyPref={sendKeyPref}
          onSendKey={handleSendKey}
          onExport={() => {
            const data = exportAll()
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `quill-export-${new Date().toISOString().slice(0, 10)}.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
          onImport={() => importJsonRef.current?.click()}
          onResetAll={() => setConfirmDelete({
            label: 'all data (every conversation, theme, provider, model preference, generation settings, and session token)',
            doDelete: () => {
              resetAllData()
              window.location.replace('/')
            },
          })}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          label={confirmDelete.label}
          onConfirm={() => { confirmDelete.doDelete(); setConfirmDelete(null) }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
