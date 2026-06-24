'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { v4 as uuidv4 } from 'uuid'
import { sendChat, initAuth } from '@/lib/api'
import {
  loadConversations, upsertConversation, deleteConversation, clearAllConversations,
  autoTitle, relativeTime, getTheme, saveTheme, type Theme,
} from '@/lib/storage'
import type { ChatMessage, Conversation } from '@/lib/types'

// ─── theme palette ───────────────────────────────────────────────────────────
//
// 15 popular dev themes (12 dark + 3 light). CSS for each lives in
// app/globals.css under `[data-theme="<id>"]`. To add a theme, extend
// the Theme type in lib/storage.ts, add the CSS block, then add an
// entry here.

const THEMES: { id: Theme; label: string }[] = [
  // dark
  { id: 'dracula',          label: 'Dracula' },
  { id: 'one-dark',         label: 'One Dark' },
  { id: 'tokyo-night',      label: 'Tokyo Night' },
  { id: 'nord',             label: 'Nord' },
  { id: 'solarized-dark',   label: 'Solarized Dark' },
  { id: 'gruvbox-dark',     label: 'Gruvbox Dark' },
  { id: 'monokai',          label: 'Monokai' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { id: 'night-owl',        label: 'Night Owl' },
  { id: 'synthwave',        label: "Synthwave '84" },
  { id: 'github-dark',      label: 'GitHub Dark' },
  { id: 'palenight',        label: 'Palenight' },
  // light
  { id: 'solarized-light',  label: 'Solarized Light' },
  { id: 'github-light',     label: 'GitHub Light' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte' },
]

// ─── icons ───────────────────────────────────────────────────────────────────

const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
)
const StopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
)
const NewChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
)
const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
)
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
)
const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
)
const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
)

// ─── delete-confirm modal ────────────────────────────────────────────────────

function DeleteConfirmModal({ label, onConfirm, onCancel }: { label: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-[color:var(--surface)] text-[color:var(--fg)] rounded-lg p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">Delete {label}?</h3>
        <p className="text-sm opacity-70 mb-5">This cannot be undone.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-md hover:bg-[color:var(--fg)]/10">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700">Delete</button>
        </div>
      </div>
    </div>
  )
}

// ─── settings modal (theme picker only for now) ──────────────────────────────

function SettingsModal({ theme, onTheme, onClose }: { theme: Theme; onTheme: (t: Theme) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[color:var(--surface)] text-[color:var(--fg)] rounded-lg p-6 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-semibold">Settings</h3>
          <button onClick={onClose} className="opacity-70 hover:opacity-100"><CloseIcon /></button>
        </div>
        <h4 className="text-sm font-medium opacity-80 mb-3">Theme</h4>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => onTheme(t.id)}
              className={`px-3 py-2 rounded-md text-sm text-left transition ${
                t.id === theme ? 'bg-[color:var(--primary)] text-[color:var(--bg)]' : 'bg-[color:var(--fg)]/5 hover:bg-[color:var(--fg)]/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Home() {
  // ── state ──
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>('dracula')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  // ── init: auth + theme + conversations ──
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    initAuth().catch(e => setError(e instanceof Error ? e.message : 'Auth failed'))
    const t = getTheme()
    setTheme(t)
    document.documentElement.setAttribute('data-theme', t)
    setConversations(loadConversations())
  }, [])

  // ── auto-scroll to bottom on message change ──
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  // ── handlers ──
  const handleTheme = useCallback((t: Theme) => {
    setTheme(t)
    saveTheme(t)
    document.documentElement.setAttribute('data-theme', t)
  }, [])

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

    try {
      const res = await sendChat(
        newMessages.map(({ role, content }) => ({ role, content })),
        abort.signal,
      )
      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: res.message,
        sources: res.sources,
      }
      const finalMessages = [...newMessages, assistantMsg]
      setMessages(finalMessages)

      // persist conversation
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
        setMessages(messages) // rollback the unanswered user message
      } else {
        const msg = e instanceof Error ? e.message : 'Request failed'
        setError(msg)
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, streaming, messages, activeId, conversations])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // ── render ──
  return (
    <div className="flex h-full bg-[color:var(--bg)] text-[color:var(--fg)]">
      {/* sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-200 overflow-hidden bg-[color:var(--surface)] flex flex-col`}>
        <div className="p-3 border-b border-[color:var(--fg)]/10 flex items-center gap-2">
          <button
            onClick={newConversation}
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-[color:var(--primary)]/10 hover:bg-[color:var(--primary)]/20 text-sm font-medium transition"
          >
            <NewChatIcon /> New chat
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-md hover:bg-[color:var(--fg)]/10 transition"
            title="Settings"
          >
            <GearIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs opacity-50 px-2 py-3">No conversations yet.</p>
          )}
          {conversations.map(c => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition ${
                c.id === activeId ? 'bg-[color:var(--primary)]/15' : 'hover:bg-[color:var(--fg)]/5'
              }`}
              onClick={() => loadConversation(c.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{c.title}</div>
                <div className="text-xs opacity-50">{relativeTime(c.updatedAt)}</div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete({ id: c.id, title: c.title }) }}
                className="opacity-0 group-hover:opacity-70 hover:opacity-100 transition"
                title="Delete"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>

        {conversations.length > 0 && (
          <div className="p-2 border-t border-[color:var(--fg)]/10">
            <button
              onClick={clearAll}
              className="w-full text-xs opacity-60 hover:opacity-100 py-2 transition"
            >
              Clear all
            </button>
          </div>
        )}
      </aside>

      {/* main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b border-[color:var(--fg)]/10 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="p-2 rounded-md hover:bg-[color:var(--fg)]/10 transition"
            title="Toggle sidebar"
          >
            <MenuIcon />
          </button>
          <h1 className="text-sm font-medium opacity-80">Quill</h1>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12 opacity-50 text-sm">
                Start a conversation.
              </div>
            )}
            {messages.map(m => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-4 py-3 rounded-lg ${
                    m.role === 'user'
                      ? 'bg-[color:var(--primary)]/15'
                      : 'bg-[color:var(--surface)]'
                  }`}
                >
                  <div className="prose prose-sm max-w-none [&>*]:my-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:text-[color:var(--primary)] [&_a]:underline">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[color:var(--fg)]/10">
                      <div className="text-xs opacity-60 mb-1">Sources</div>
                      <ul className="space-y-1">
                        {m.sources.map((s, i) => (
                          <li key={i} className="text-xs">
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[color:var(--primary)] hover:underline">
                              {s.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {streaming && (
              <div className="flex justify-start">
                <div className="bg-[color:var(--surface)] px-4 py-3 rounded-lg text-sm opacity-60">
                  Thinking…
                </div>
              </div>
            )}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-500 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[color:var(--fg)]/10 p-4">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Send a message…"
              rows={1}
              className="flex-1 resize-none rounded-md bg-[color:var(--surface)] border border-[color:var(--fg)]/10 px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--primary)]/50 max-h-40"
              disabled={streaming}
            />
            <button
              onClick={streaming ? stop : send}
              disabled={!streaming && !input.trim()}
              className="p-3 rounded-md bg-[color:var(--primary)] text-[color:var(--bg)] disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition"
              title={streaming ? 'Stop' : 'Send'}
            >
              {streaming ? <StopIcon /> : <SendIcon />}
            </button>
          </div>
        </div>
      </div>

      {settingsOpen && <SettingsModal theme={theme} onTheme={handleTheme} onClose={() => setSettingsOpen(false)} />}
      {confirmDelete && (
        <DeleteConfirmModal
          label={`"${confirmDelete.title}"`}
          onConfirm={() => { removeConversation(confirmDelete.id); setConfirmDelete(null) }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
