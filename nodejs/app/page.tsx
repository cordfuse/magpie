'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { v4 as uuidv4 } from 'uuid'
import { sendChatStream, initAuth, getProviders, type AvailableProvider } from '@/lib/api'
import {
  loadConversations, upsertConversation, deleteConversation, renameConversation,
  clearAllConversations, autoTitle, relativeTime, getTheme, saveTheme, type Theme,
  getSelectedProvider, setSelectedProvider, getSelectedModel, setSelectedModel,
} from '@/lib/storage'
import type { ChatMessage, Conversation } from '@/lib/types'

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
  // dark (12)
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
  { label: 'Dark',  ids: ['dracula','one-dark','tokyo-night','nord','solarized-dark','gruvbox-dark','monokai','catppuccin-mocha','night-owl','synthwave','github-dark','palenight'] },
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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
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

function SettingsPanel({ theme, onTheme, providers, selectedProvider, onProvider, onClose }: {
  theme: Theme
  onTheme: (t: Theme) => void
  providers: AvailableProvider[]
  selectedProvider: string
  onProvider: (p: string) => void
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)

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
                {providerOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setProviderOpen(false)} />
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden max-h-[60vh] overflow-y-auto">
                      {providers.map(p => {
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
                  </>
                )}
              </div>
              {activeProvider && !activeProvider.available && (
                <p className="mt-1.5 text-[10px] text-fg-4">
                  Set <code className="font-mono">{providers.find(p => p.id === selectedProvider)?.id.toUpperCase()}_API_KEY</code> in <code className="font-mono">.env.local</code> and restart the server.
                </p>
              )}
            </div>
          )}

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
  onSelectConv, onDeleteConv, onRenameConv, onNewChat, onOpenSettings, onClearAll,
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
  onNewChat: () => void
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
        <div className="flex items-center justify-between px-3 py-3 shrink-0 min-w-[260px] border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <QuillIcon />
            <span className="text-sm font-medium text-fg whitespace-nowrap">Quill</span>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg transition-colors lg:hidden" aria-label="Close sidebar">
            <CloseIcon />
          </button>
        </div>

        {/* new chat */}
        <div className="px-3 pt-3 pb-2 shrink-0 min-w-[260px]">
          <button
            onClick={() => { onNewChat(); onClose() }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-surface-2 hover:bg-surface-3 px-3 py-2 text-xs text-fg transition-colors"
          >
            <NewChatIcon /> New chat
          </button>
        </div>

        {/* search */}
        <div className="px-3 pb-2 shrink-0 min-w-[260px]">
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

        {/* footer: settings + clear all */}
        <div className="shrink-0 min-w-[260px] border-t border-white/10 px-3 py-2 flex items-center justify-between">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-fg-3 hover:text-fg transition-colors"
            title="Settings"
          >
            <GearIcon /> Settings
          </button>
          {conversations.length > 0 && (
            <button
              onClick={onClearAll}
              className="px-2 py-1.5 text-[11px] text-fg-4 hover:text-fg-2 transition-colors"
              title="Clear all conversations"
            >
              Clear all
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Home() {
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
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; doDelete: () => void } | null>(null)
  const [search, setSearch] = useState('')
  const [providers, setProviders] = useState<AvailableProvider[]>([])
  const [provider, setProviderState] = useState<string>('anthropic')
  const [model, setModelState] = useState<string>('claude-sonnet-4-6')
  const [modelOpen, setModelOpen] = useState(false)

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
    setConversations(loadConversations())
    // open sidebar by default on wide screens
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarOpen(true)
    }
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
        const list = await getProviders()
        setProviders(list)
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

  const newConversation = useCallback(() => {
    setActiveId(null)
    setMessages([])
    setError(null)
    setInput('')
  }, [])

  const loadConversation = useCallback((id: string) => {
    const conv = conversations.find(c => c.id === id)
    if (!conv) return
    setActiveId(id)
    setMessages(conv.messages)
    setError(null)
  }, [conversations])

  const removeConversation = useCallback((id: string) => {
    deleteConversation(id)
    setConversations(loadConversations())
    if (activeId === id) {
      setActiveId(null)
      setMessages([])
    }
  }, [activeId])

  const handleRename = useCallback((id: string, title: string) => {
    renameConversation(id, title)
    setConversations(loadConversations())
  }, [])

  const clearAll = useCallback(() => {
    clearAllConversations()
    setConversations([])
    setActiveId(null)
    setMessages([])
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: ChatMessage = { id: uuidv4(), role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setError(null)
    setStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    const assistantId = uuidv4()
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '' }
    setMessages([...newMessages, assistantMsg])

    try {
      const res = await sendChatStream(
        newMessages.map(({ role, content }) => ({ role, content })),
        delta => {
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m
          ))
        },
        abort.signal,
        { provider, model },
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
      if (!activeId) setActiveId(convId)
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
      abortRef.current = null
    }
  }, [input, streaming, messages, activeId, conversations, provider, model])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
        onDeleteConv={(id, title) => setConfirmDelete({ title, doDelete: () => removeConversation(id) })}
        onRenameConv={handleRename}
        onNewChat={newConversation}
        onOpenSettings={() => { setSettingsOpen(true); setSidebarOpen(false) }}
        onClearAll={clearAll}
      />

      {/* main column */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg">
        <header className="px-3 py-3 flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-3 hover:bg-surface hover:text-fg transition-colors"
            title="Open chats"
            aria-label="Open chats"
          >
            <MenuIcon />
          </button>
          <h1 className="text-sm font-medium text-fg">Quill</h1>
          {/* Model pill */}
          {providers.length > 0 && (() => {
            const providerInfo = providers.find(p => p.id === provider)
            if (!providerInfo) return null
            const modelInfo = providerInfo.models.find(m => m.id === model)
            return (
              <div className="relative">
                <button
                  onClick={() => setModelOpen(o => !o)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-surface-2 px-2.5 py-1.5 text-xs text-fg-2 hover:bg-surface-3 hover:text-fg transition-colors"
                  title={`${providerInfo.label} — change model`}
                >
                  <span className="truncate max-w-[10rem]">{modelInfo?.label ?? model}</span>
                  <ChevronIcon open={modelOpen} />
                </button>
                {modelOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setModelOpen(false)} />
                    <div className="absolute left-0 top-full z-40 mt-1 min-w-[14rem] rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden">
                      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-4 bg-surface">{providerInfo.label}</p>
                      {providerInfo.models.map(m => {
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
          <div className="flex-1" />
          {activeId && (
            <button
              onClick={() => {
                const conv = conversations.find(c => c.id === activeId)
                if (!conv) return
                setConfirmDelete({
                  title: conv.title,
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
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm ${
                  m.role === 'user'
                    ? 'bg-primary/15 text-fg'
                    : 'bg-surface text-fg'
                }`}>
                  {m.role === 'assistant' && m.content.length === 0 && streaming
                    ? <span className="inline-flex gap-1 items-end h-4"><span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-3" /><span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-3" /><span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-3" /></span>
                    : <div className="prose prose-sm max-w-none [&>*]:my-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:text-primary [&_a]:underline [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-surface-2 [&_pre]:bg-surface-2 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                  }
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <div className="text-[10px] text-fg-3 mb-1 uppercase tracking-wider">Sources</div>
                      <ul className="space-y-1">
                        {m.sources.map((s, i) => (
                          <li key={i} className="text-xs">
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{s.title}</a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
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

        {/* composer */}
        <div className="px-4 pb-4 pt-2 shrink-0">
          <div className="max-w-3xl mx-auto rounded-3xl border border-white/10 bg-surface transition-colors focus-within:border-primary/40">
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
            <div className="flex items-center justify-end px-2.5 pb-2.5">
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
                  disabled={!input.trim()}
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

      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          onTheme={handleTheme}
          providers={providers}
          selectedProvider={provider}
          onProvider={handleProvider}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          label={`"${confirmDelete.title}"`}
          onConfirm={() => { confirmDelete.doDelete(); setConfirmDelete(null) }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
