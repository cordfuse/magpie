'use client'

import { useState, useEffect, useRef, useCallback, forwardRef } from 'react'
import { flushSync } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { v4 as uuidv4 } from 'uuid'
import { sendChat, initAuth, decodeQr, convertPreset, identifyQr, scanQrFromFile } from '@/lib/api'
import {
  loadHistory, saveToHistory, deleteHistoryItem, renameHistoryItem, clearAllHistory,
  loadConversations, upsertConversation,
  deleteConversation, clearAllConversations, autoTitle, relativeTime,
  getTheme, saveTheme,
  getDefaultDevice, saveDefaultDevice,
  getHintDismissed, saveHintDismissed,
  getWelcomeSeen, saveWelcomeSeen,
  type Theme, type NuxDevice,
  NUX_DEVICES,
} from '@/lib/storage'
import type { ChatMessage, QrResult, HistoryItem, Conversation } from '@/lib/types'
import pkg from '../package.json'
import JSZip from 'jszip'

async function downloadQrZip(items: HistoryItem[], filename: string) {
  const zip = new JSZip()
  const nameCounts = new Map<string, number>()
  for (const item of items) {
    const base64 = item.imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const device = (item.deviceName || item.qr.deviceName || 'Unknown Device').replace(/[^a-z0-9_\-. ]/gi, '_')
    const safeName = item.presetName.replace(/[^a-z0-9_\-. ]/gi, '_')
    const key = `${device}/${safeName}`
    const count = nameCounts.get(key) ?? 0
    nameCounts.set(key, count + 1)
    const fileName = count === 0 ? `${safeName}.png` : `${safeName}_${count}.png`
    zip.file(`${device}/${fileName}`, base64, { base64: true })
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (lower.includes('400') || lower.includes('bad request'))
    return 'The provider rejected the request (400). Your API key may be invalid or the selected model may not be supported — check Settings.'
  if (lower.includes('401') || lower.includes('authentication') || lower.includes('auth_subevent') || lower.includes('invalid_api_key') || lower.includes('incorrect api key'))
    return 'API key is invalid or missing. Check your key in Settings.'
  if (lower.includes('403') || lower.includes('permission') || lower.includes('forbidden'))
    return 'Your API key does not have permission to use this model.'
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests'))
    return 'Rate limit reached. Wait a moment and try again.'
  if (lower.includes('quota') || lower.includes('billing') || lower.includes('credit'))
    return 'API quota or billing limit reached. Check your account.'
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('econnrefused') || lower.includes('load failed'))
    return 'Could not reach the server. Check your connection or base URL.'
  if (lower.includes('timeout') || lower.includes('timed out'))
    return 'Request timed out. Try again.'
  if (lower.includes('no qr') || lower.includes('no qr code generated'))
    return 'No QR code was generated. Try rephrasing your request.'
  return msg
}

const ALL_SUGGESTIONS = [
  'Kashmir tone from Knebworth 1979', 'Eruption Eddie Van Halen brown sound',
  'Texas Flood SRV strat bite', 'Hotel California clean chimey lead',
  'Back in Black power chord crunch', 'Sultans of Swing Knopfler fingerpicked',
  'Little Wing Hendrix gentle clean', 'Comfortably Numb solo sustain',
  'Bohemian Rhapsody May mid-gain tone', 'Sweet Child O Mine Slash lead',
  'November Rain ballad clean', 'Master of Puppets tight rhythm',
  'Enter Sandman heavy palm-mute', 'Smells Like Teen Spirit grunge crunch',
  'Purple Rain Prince sustain lead', 'Free Bird dual harmony lead',
  'Highway Star Blackmore overdriven', 'Crazy Train Randy Rhoads',
  'For the Love of God Vai stratospheric', 'Cliffs of Dover Johnson expressive',
  'Europa Santana singing lead', 'Layla Clapton electric slide',
  'While My Guitar Gently Weeps Harrison', 'More Than a Feeling Boston lead',
  'Whole Lotta Love Page crunch riff', 'Stairway to Heaven acoustic intro',
  'Black Dog heavy mid-boosted', 'Paranoid Black Sabbath riff',
  'Iron Man dirty riff tone', 'Smoke on the Water Blackmore',
  'Warm jazz chord clean tone', 'Chicago blues gritty shuffle',
  'Delta blues raw slide tone', 'Classic country chicken-pickin',
  'Nashville sparkle twang clean', 'Funk rhythm staccato chop',
  'Soul Motown smooth chord', 'Reggae skanking choppy clean',
  'Bossa nova fingerpicked clean', 'Gypsy jazz Django rhythm tone',
  'Doom metal heavy sustained', 'Thrash metal tight gallop',
  '80s arena rock big hair solo', '70s classic rock warm crunch',
  '60s British invasion jangle', '50s rockabilly slap-back clean',
  'Shoegaze wall of fuzz reverb', 'Modern progressive metal tight',
  'Lo-fi bedroom indie warm clean', 'Melancholy rainy night sustain',
  'Euphoric stadium anthem crunch', 'Haunting ambient reverb wash',
  'Uplifting bright chimey clean', 'Aggressive punchy attack',
  'Smooth silky clean lead', 'Brooding dark minor crunch',
  'Playful light funk clean', 'Epic cinematic swell',
  'Fender Twin Reverb sparkle', 'Vox AC30 chimey top-boost',
  'Marshall Plexi medium crunch', 'Marshall JCM800 classic lead',
  'Mesa Dual Rectifier heavy chunk', 'Soldano SLO smooth lead',
  'Long hall reverb clean pad', 'Tap tempo delay ambient wash',
  'Chorus shimmer clean arpeggio', 'Tremolo surf guitar wobble',
  'Flanger jet sweep effect', 'Phaser slow rotating sweep',
  'Uni-vibe psychedelic swirl', 'Big Muff fuzz sustain',
  'Tube screamer mid-boost crunch', 'Slapback delay rockabilly',
  '1955 Scotty Moore clean rockabilly', '1965 British Invasion jangle',
  '1969 Woodstock saturated', '1973 glam rock compressed',
  '1978 disco funk clean', '1982 arena rock lead',
  '1987 shred metal high gain', '1991 alternative grunge',
  '2000s post-rock ambient swell', 'Small jazz club warm intimate',
  'Recording studio dry clean direct', 'Outdoor festival wall of sound',
  'Dive bar raw gritty amp', 'Church hall spacious reverb',
  'Violin-like singing lead bend', 'Cello-like warm midrange lead',
  'Bell-like clean piano attack', 'Talking box wah filter sweep',
  'Depeche Mode dark synth-like', 'U2 The Edge dotted delay',
  'Radiohead Jonny Greenwood angular', 'PJ Harvey raw grunge lead',
  'Kurt Cobain in Utero distortion', 'Jack White raw two-piece crunch',
  'John Frusciante funky clean', 'Dave Murray Iron Maiden harmony lead',
  'Alex Lifeson YYZ clean intro', 'Carlos Santana warm singing tone',
]

function getRandomSuggestions(n = 6, exclude: string[] = []): string[] {
  const pool = ALL_SUGGESTIONS.filter(s => !exclude.includes(s))
  const source = pool.length >= n ? pool : [...ALL_SUGGESTIONS]
  const out: string[] = []
  const remaining = [...source]
  while (out.length < n && remaining.length > 0) {
    const i = Math.floor(Math.random() * remaining.length)
    out.push(remaining.splice(i, 1)[0])
  }
  return out
}

const THEMES: { id: Theme; label: string; bg: string; surface: string; fg: string; primary: string; desc: string }[] = [
  { id: 'dark',           label: 'Dark',             bg: '#202124', surface: '#292a2d', fg: '#e8eaed', primary: '#8ab4f8', desc: 'Google dark' },
  { id: 'oled',           label: 'OLED',             bg: '#000000', surface: '#0d0d0d', fg: '#e0e0e0', primary: '#00bcd4', desc: 'Pure black' },
  { id: 'light',          label: 'Light',            bg: '#f0f2f5', surface: '#ffffff', fg: '#202124', primary: '#1a73e8', desc: 'Clean light' },
  { id: 'tweed',          label: 'Tweed',            bg: '#221608', surface: '#2e1e0c', fg: '#f5e6c8', primary: '#d4a843', desc: 'Fender warmth' },
  { id: 'tweed-lt',       label: 'Tweed Light',      bg: '#efe9d6', surface: '#fdf7ea', fg: '#2e1a04', primary: '#9a7418', desc: 'Cream linen' },
  { id: 'amber',          label: 'Amber',            bg: '#160f00', surface: '#201600', fg: '#ffe4a0', primary: '#ffab40', desc: 'Tube glow' },
  { id: 'amber-lt',       label: 'Amber Light',      bg: '#f5edcc', surface: '#fdf8e8', fg: '#2a1c00', primary: '#c07800', desc: 'Warm parchment' },
  { id: 'british',        label: 'British',          bg: '#0c1a0c', surface: '#142014', fg: '#e2edd6', primary: '#c9a227', desc: 'Marshall green' },
  { id: 'british-lt',     label: 'British Light',    bg: '#e8eddc', surface: '#f6faf0', fg: '#101a06', primary: '#7a6010', desc: 'Sage panel' },
  { id: 'oxblood',        label: 'Oxblood',          bg: '#180808', surface: '#220e0e', fg: '#f5dede', primary: '#e07070', desc: 'Vintage tolex' },
  { id: 'oxblood-lt',     label: 'Oxblood Light',    bg: '#f0e4e4', surface: '#fdf5f5', fg: '#200808', primary: '#8a2020', desc: 'Blush cream' },
  { id: 'silver',         label: 'Silver Panel',     bg: '#1a1c1e', surface: '#26292c', fg: '#dce3e8', primary: '#b8a882', desc: 'Boutique silver' },
  { id: 'silver-lt',      label: 'Silver Light',     bg: '#e8eaec', surface: '#f8f9fa', fg: '#16181a', primary: '#7a6840', desc: 'Platinum day' },
  { id: 'pedalboard',     label: 'Pedalboard',       bg: '#0f1410', surface: '#171d18', fg: '#c8d4c0', primary: '#5a9e4a', desc: 'Signal chain' },
  { id: 'pedalboard-lt',  label: 'Pedalboard Light', bg: '#dce8d8', surface: '#f0f8ec', fg: '#0c1c08', primary: '#386820', desc: 'Military sage' },
  { id: 'blackface',      label: 'Blackface',        bg: '#0a0e1a', surface: '#111827', fg: '#d8dff0', primary: '#7eb8d4', desc: 'Fender silver' },
  { id: 'blackface-lt',   label: 'Blackface Light',  bg: '#d8e4f0', surface: '#f0f6fd', fg: '#060e1c', primary: '#1a5a9a', desc: 'Silver-blue day' },
  { id: 'plexi',          label: 'Plexi',            bg: '#1a1200', surface: '#251a00', fg: '#f0e6c8', primary: '#d4930a', desc: 'Marshall gold' },
  { id: 'plexi-lt',       label: 'Plexi Light',      bg: '#f0e8c8', surface: '#fdf6e4', fg: '#1c1000', primary: '#8a6000', desc: 'Gold parchment' },
]

// ─── Icons ────────────────────────────────────────────────────────────────────

const AppIcon = () => (
  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="2" width="6" height="6" rx="1.5" fill="white" />
      <rect x="3.5" y="3.5" width="3" height="3" rx="0.5" fill="#1a73e8" />
      <rect x="12" y="2" width="6" height="6" rx="1.5" fill="white" />
      <rect x="13.5" y="3.5" width="3" height="3" rx="0.5" fill="#1a73e8" />
      <rect x="2" y="12" width="6" height="6" rx="1.5" fill="white" />
      <rect x="3.5" y="13.5" width="3" height="3" rx="0.5" fill="#1a73e8" />
      <rect x="12" y="12" width="2.5" height="2.5" rx="0.5" fill="white" />
      <rect x="15.5" y="12" width="2.5" height="2.5" rx="0.5" fill="white" />
      <rect x="12" y="15.5" width="2.5" height="2.5" rx="0.5" fill="white" />
      <rect x="15.5" y="15.5" width="2.5" height="2.5" rx="0.5" fill="white" />
    </svg>
  </div>
)

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 4l-1.41 1.41L17.17 11H4v2h13.17l-6.58 6.59L12 21l9-9z" transform="rotate(-90 12 12)" />
  </svg>
)

const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
)

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const NewChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    <line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
  </svg>
)

const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 16 12 12 8 16" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
)

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h18M3 6h18M3 18h18" />
  </svg>
)

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)

const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
)

const YoutubeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.54 6.42a2.78 2.78 0 00-1.95-1.97C18.88 4 12 4 12 4s-6.88 0-8.59.45A2.78 2.78 0 001.46 6.42 29 29 0 001 12a29 29 0 00.46 5.58A2.78 2.78 0 003.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.4a2.78 2.78 0 001.95-1.97A29 29 0 0023 12a29 29 0 00-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
  </svg>
)

const FacebookIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
  </svg>
)

const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)

const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
)

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
  </svg>
)

const VolumeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
)

const VolumeOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
  </svg>
)

const EyeIcon = ({ show }: { show: boolean }) => show ? (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" />
  </svg>
) : (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
)

// ─── QR Import Helpers ────────────────────────────────────────────────────────

const NUX_DEVICE_NAMES: Record<number, string> = {
  15: 'Mighty Plug Pro / Space', 19: 'Mighty Lite MkII', 20: 'Mighty 8BT MkII',
  21: 'Mighty 20BT MkII', 22: 'Mighty 40BT MkII', 23: 'Mighty 60BT MkII',
  11: 'Mighty Plug / Air', 9: 'Mighty Lite BT', 12: 'Mighty 8BT',
  7: 'Mighty 20/40BT', 8: 'Mighty 40BT', 10: 'Mighty Go', 6: 'Mighty Air',
}

function parseNuxQr(qrString: string): { presetName: string; deviceName: string } | null {
  if (!qrString.startsWith('nux://MightyAmp:')) return null
  try {
    const bytes = Uint8Array.from(atob(qrString.slice(16)), c => c.charCodeAt(0))
    const deviceName = NUX_DEVICE_NAMES[bytes[0]] ?? 'NUX MightyAmp'
    let presetName = 'Imported Preset'
    if (bytes.length >= 115) {
      const raw = bytes.slice(100, 116)
      const end = raw.indexOf(0)
      const name = new TextDecoder().decode(end >= 0 ? raw.slice(0, end) : raw).trim()
      if (name) presetName = name
    }
    return { presetName, deviceName }
  } catch { return null }
}


const OCR_FALSE_FLAGS = [
  'mighty ai', 'mighty amp', 'mightyamp', 'nux', 'plugpro', 'plug pro',
  'generated by', 'scan me', 'scan to', 'qr code', 'www.', 'http',
]

async function ocrImageText(bitmap: ImageBitmap): Promise<string> {
  if (typeof window === 'undefined' || !('TextDetector' in window)) return ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detector = new (window as any).TextDetector()
    const results: { rawValue: string }[] = await detector.detect(bitmap)
    const filtered = results
      .map(r => r.rawValue.trim())
      .filter(t => {
        if (t.length < 3) return false
        const lower = t.toLowerCase()
        return !OCR_FALSE_FLAGS.some(f => lower.includes(f))
      })
    return filtered.join(' ').trim()
  } catch {
    return ''
  }
}

// ─── QR Image (canvas — bakes header/footer into the PNG) ─────────────────────

const QrImage = forwardRef<HTMLCanvasElement, { imageBase64: string; presetName: string; deviceName?: string; size?: number }>(
  function QrImage({ imageBase64, presetName, deviceName, size = 176 }, ref) {
    const internalRef = useRef<HTMLCanvasElement>(null)
    const canvasRef = (ref as React.RefObject<HTMLCanvasElement>) ?? internalRef

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const img = new Image()
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1
        const pad = 16
        const headerH = 36
        const footerH = 48
        const w = size + pad * 2
        const h = size + headerH + footerH

        canvas.width  = w * dpr
        canvas.height = h * dpr
        canvas.style.width  = `${w}px`
        canvas.style.height = `${h}px`

        ctx.scale(dpr, dpr)

        // Background
        ctx.fillStyle = '#0f0f0f'
        ctx.fillRect(0, 0, w, h)

        // Header: app name (left, red) + version (right, grey)
        ctx.font      = 'bold 10px system-ui,sans-serif'
        ctx.fillStyle = '#e63946'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText('Mighty AI QR', pad, headerH / 2)

        ctx.font      = '9px system-ui,sans-serif'
        ctx.fillStyle = '#aaaaaa'
        ctx.textAlign = 'right'
        ctx.fillText(`v${process.env.NEXT_PUBLIC_APP_VERSION ?? ''}`, w - pad, headerH / 2)

        // Header divider
        ctx.fillStyle = '#e63946'
        ctx.globalAlpha = 0.4
        ctx.fillRect(0, headerH - 1, w, 1)
        ctx.globalAlpha = 1

        // QR code
        ctx.drawImage(img, pad, headerH, size, size)

        // Footer divider
        ctx.fillStyle = '#e63946'
        ctx.globalAlpha = 0.4
        ctx.fillRect(0, headerH + size, w, 1)
        ctx.globalAlpha = 1

        // Footer: preset name + device name
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        ctx.font      = 'bold 10px system-ui,sans-serif'
        ctx.fillText(presetName, w / 2, headerH + size + footerH * 0.36, w - pad * 2)

        if (deviceName) {
          ctx.fillStyle = '#aaaaaa'
          ctx.font      = '9px system-ui,sans-serif'
          ctx.fillText(deviceName, w / 2, headerH + size + footerH * 0.68, w - pad * 2)
        }
      }
      img.src = imageBase64
    }, [imageBase64, presetName, deviceName, size, canvasRef])

    return <canvas ref={canvasRef} style={{ width: size, height: size + 84 }} />
  }
)

function useLongPress(onLongPress: () => void, delay = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moved = useRef(false)
  const fired = useRef(false)

  const start = useCallback(() => {
    moved.current = false
    fired.current = false
    timer.current = setTimeout(() => {
      if (!moved.current) {
        fired.current = true
        onLongPress()
      }
    }, delay)
  }, [onLongPress, delay])

  const cancel = useCallback((e?: React.TouchEvent) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    // suppress the synthetic click that fires after a long press
    if (fired.current && e) e.preventDefault()
  }, [])

  const onMove = useCallback(() => {
    moved.current = true
    cancel()
  }, [cancel])

  return { onTouchStart: start, onTouchEnd: cancel, onTouchMove: onMove }
}

function useQrDownload(canvasRef: React.RefObject<HTMLCanvasElement | null>, presetName: string) {
  return () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${presetName.replace(/[^a-z0-9]/gi, '_')}.png`
    a.click()
  }
}

function useQrShare(canvasRef: React.RefObject<HTMLCanvasElement | null>, presetName: string) {
  const [shareLabel, setShareLabel] = useState('Share')
  const share = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const title = `${presetName} — Mighty AI QR`
    const text = `Check out this guitar tone: ${presetName}`
    canvas.toBlob(async blob => {
      if (!blob) return
      const file = new File([blob], `${presetName.replace(/[^a-z0-9]/gi, '_')}.png`, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title, text }); return } catch {}
      }
      if (navigator.share) {
        try { await navigator.share({ title, text }); return } catch {}
      }
      // Desktop fallback: copy image to clipboard + open Facebook
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        setShareLabel('Copied!')
        setTimeout(() => setShareLabel('Share'), 2000)
      } catch {}
      window.open('https://www.facebook.com/', '_blank', 'noopener,noreferrer')
    }, 'image/png')
  }
  return { share, shareLabel }
}

// ─── QR Card ──────────────────────────────────────────────────────────────────

function QrCard({ qr, description, className = '', nameOverride, onRename }: { qr: QrResult; description?: string; className?: string; nameOverride?: string; onRename?: (name: string) => void }) {
  const displayName = nameOverride ?? qr.presetName
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState(displayName)
  const [copied, setCopied] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const download = useQrDownload(canvasRef, displayName)
  const { share, shareLabel } = useQrShare(canvasRef, displayName)
  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(displayName + ' guitar tone')}`

  useEffect(() => { if (!editingName) setEditName(displayName) }, [displayName, editingName])
  useEffect(() => { if (editingName) nameInputRef.current?.focus() }, [editingName])

  const commitCardRename = () => {
    const trimmed = editName.trim()
    if (trimmed && onRename) onRename(trimmed)
    else setEditName(displayName)
    setEditingName(false)
  }

  return (
    <div className={`rounded-2xl border border-white/10 bg-surface-2 overflow-hidden ${className}`}>
      <div className="flex justify-center bg-white p-4">
        <QrImage ref={canvasRef} imageBase64={qr.imageBase64} presetName={displayName} deviceName={qr.deviceName}/>
      </div>
      <div className="p-4 space-y-3">
        <div>
          {onRename && editingName ? (
            <input
              ref={nameInputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={commitCardRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitCardRename()
                if (e.key === 'Escape') { setEditName(displayName); setEditingName(false) }
              }}
              className="w-full rounded-lg border border-primary/50 bg-surface-3 px-3 py-1.5 text-sm font-medium text-fg outline-none"
            />
          ) : onRename ? (
            <button onClick={() => setEditingName(true)} className="text-left group">
              <p className="text-sm font-medium text-fg leading-tight group-hover:text-primary transition-colors">
                {displayName} <span className="text-[10px] text-fg-4 group-hover:text-fg-3">rename</span>
              </p>
            </button>
          ) : (
            <p className="text-sm font-medium text-fg leading-tight">{displayName}</p>
          )}
          <p className="text-xs text-fg-3 mt-0.5">{qr.deviceName}</p>
          {description && (
            <p className="text-[11px] text-fg-4 leading-relaxed mt-1.5">{description}</p>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button onClick={download} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
            <DownloadIcon /> Save
          </button>
          <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
            <YoutubeIcon /> YT
          </a>
          <button onClick={share} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
            <FacebookIcon /> {shareLabel}
          </button>
          <button
            onClick={() => { if (qr.qrString) { navigator.clipboard.writeText(qr.qrString); setCopied(true); setTimeout(() => setCopied(false), 2000) } }}
            disabled={!qr.qrString}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors disabled:opacity-40"
          >
            <CopyIcon /> {copied ? '✓' : 'Copy'}
          </button>
        </div>
        <div className="border-t border-white/10 pt-3">
          <button onClick={() => setSettingsOpen(o => !o)} className="flex w-full items-center justify-between text-xs text-fg-3 hover:text-fg transition-colors">
            <span>Tone settings</span>
            <ChevronIcon open={settingsOpen} />
          </button>
          <div className={`grid transition-all duration-200 ease-in-out ${settingsOpen ? 'grid-rows-[1fr] mt-2' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="space-y-1.5">
                {qr.settings.map((slot, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${slot.enabled ? 'bg-green-400' : 'bg-fg-4'}`} />
                    <div className="min-w-0">
                      <span className="text-[11px] text-fg-3">{slot.slot}: </span>
                      <span className="text-[11px] text-fg">{slot.selection}</span>
                      {slot.params && Object.keys(slot.params).length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3">
                          {Object.entries(slot.params).slice(0, 4).map(([k, v]) => (
                            <span key={k} className="text-[10px] text-fg-4">{k}: {v}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Error Explain Modal ──────────────────────────────────────────────────────

const ERROR_EXPLANATIONS: { match: (msg: string) => boolean; title: string; body: string; fix: string }[] = [
  {
    match: m => m.includes('free request limit'),
    title: "Today's free requests used up",
    body: "This app offers a limited number of free AI requests per day shared across all users. Today's quota has been reached.",
    fix: "Add your own API key in Settings to keep going. Anthropic gives free credits on signup at console.anthropic.com — no payment method required.",
  },
  {
    match: m => m.includes('429') || m.includes('quota') || m.includes('rate'),
    title: 'Too many requests or quota exceeded (429)',
    body: 'Your API key has hit a limit. This can mean:\n• You\'ve run out of credits on this account\n• You\'re on a free tier with low rate limits\n• You\'re sending requests too fast',
    fix: 'Check your billing/usage page for this provider and top up credits or upgrade your plan.',
  },
  {
    match: m => m.includes('401') || m.includes('Unauthorized') || m.includes('invalid_api_key') || m.includes('authentication'),
    title: 'Invalid or missing API key (401)',
    body: 'The API key was rejected. This usually means:\n• The key was entered incorrectly\n• The key has been revoked\n• The key belongs to a different provider',
    fix: 'Double-check the key in Settings. Copy it fresh from the provider\'s dashboard.',
  },
  {
    match: m => m.includes('403') || m.includes('Forbidden') || m.includes('permission'),
    title: 'Access denied (403)',
    body: 'Your key doesn\'t have permission to use this model or endpoint.',
    fix: 'Check that your account has access to the selected model, or try a different model.',
  },
  {
    match: m => m.includes('insufficient_quota'),
    title: 'Account has no credits (insufficient_quota)',
    body: 'Your account has a zero balance. Requests will fail until you add credits.',
    fix: 'Add a payment method and purchase credits on the provider\'s billing page.',
  },
  {
    match: m => m.includes('model') && (m.includes('not found') || m.includes('does not exist')),
    title: 'Model not found',
    body: 'The selected model name doesn\'t exist or isn\'t available on your account.',
    fix: 'Open Settings and choose a different model from the dropdown.',
  },
  {
    match: m => m.includes('503') || m.includes('service unavailable'),
    title: 'Local LLM not running (503)',
    body: 'The server at the configured base URL is not available. This usually means:\n• Ollama / LM Studio / Open WebUI is not running\n• The service crashed or hasn\'t started yet',
    fix: 'Start your local LLM server and try again. For Ollama: run `ollama serve`. For LM Studio: open the app and start the local server.',
  },
  {
    match: m => m.includes('502') || m.includes('bad gateway'),
    title: 'Cannot reach local LLM (502)',
    body: 'The request reached a proxy or gateway but it couldn\'t connect to your local LLM behind it.',
    fix: 'Check that your local LLM is running and that the base URL in Settings is correct (including port).',
  },
  {
    match: m => m.includes('504') || m.includes('gateway timeout') || m.includes('timed out') || m.includes('timeout'),
    title: 'Request timed out (504)',
    body: 'The model took too long to respond. This happens with large models or when the machine is under heavy load.',
    fix: 'Try a smaller/faster model, or wait and try again. For Ollama, the first request after startup can be slow while the model loads.',
  },
  {
    match: m => m.includes('500') || m.includes('internal server error'),
    title: 'LLM server error (500)',
    body: 'The local LLM server encountered an internal error. This can happen when:\n• The model doesn\'t support tool/function calling\n• The request format isn\'t compatible with this server\n• The model ran out of context or memory',
    fix: 'Try switching to a model that supports tool calling (e.g. llama3.2, mistral-nemo, qwen2.5). Check your LLM server logs for details.',
  },
  {
    match: m => m.includes('econnrefused') || m.includes('connection refused') || m.includes('fetch failed') || m.includes('enotfound'),
    title: 'Connection refused',
    body: 'Nothing is listening at the configured base URL. The local LLM server is either not running or on a different port.',
    fix: 'Start your local LLM server and verify the base URL in Settings matches the port it\'s running on (e.g. http://localhost:11434/v1 for Ollama).',
  },
]

function getErrorExplanation(msg: string) {
  const lower = msg.toLowerCase()
  return ERROR_EXPLANATIONS.find(e => e.match(lower)) ?? null
}

function ErrorExplainModal({ error, onClose }: { error: string; onClose: () => void }) {
  const explanation = getErrorExplanation(error)
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-fg">{explanation?.title ?? 'Something went wrong'}</p>
            <button onClick={onClose} className="text-fg-4 hover:text-fg-2 transition-colors shrink-0"><CloseIcon /></button>
          </div>
          {explanation ? (
            <>
              <p className="text-xs text-fg-3 whitespace-pre-line">{explanation.body}</p>
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                <p className="text-[11px] font-medium text-primary mb-0.5">How to fix</p>
                <p className="text-[11px] text-fg-3">{explanation.fix}</p>
              </div>
            </>
          ) : (
            <p className="text-xs text-fg-3">{error}</p>
          )}
          <p className="text-[10px] text-fg-4 border-t border-white/5 pt-3">Raw error: {error}</p>
        </div>
      </div>
    </>
  )
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({ label, onConfirm, onCancel }: {
  label: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-xs rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up p-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-fg">Delete this?</p>
            <p className="mt-1 text-xs text-fg-3 truncate">{label}</p>
          </div>
          <p className="text-xs text-fg-4">This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={onCancel} className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-fg-3 hover:text-fg transition-colors">
              Cancel
            </button>
            <button onClick={onConfirm} className="flex-1 rounded-lg bg-surface-3 border border-white/10 py-2.5 text-sm font-medium text-fg hover:bg-surface-2 transition-colors">
              Delete
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Identify Confirm Modal ────────────────────────────────────────────────────

function IdentifyConfirmModal({ artist, song, onConfirm, onDismiss }: {
  artist: string; song: string; onConfirm: () => void; onDismiss: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onDismiss} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-xs rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up p-6 space-y-4">
          <div>
            <p className="text-sm font-medium text-fg">Is this the right song?</p>
            <p className="mt-2 text-sm text-fg-2">
              <span className="font-semibold">{artist}</span> — {song}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={onDismiss} className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-fg-3 hover:text-fg transition-colors">
              No
            </button>
            <button onClick={onConfirm} className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-on-primary hover:opacity-90 transition-colors">
              Yes
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function ImportNameModal({ qr, suggestedName, onSave, onCancel }: {
  qr: QrResult; suggestedName?: string; onSave: (name: string) => void; onCancel: () => void
}) {
  const [name, setName] = useState(suggestedName ?? qr.importNote ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  const commit = () => { const t = name.trim(); if (t) onSave(t) }
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-xs rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up p-6 space-y-4" onClick={e => e.stopPropagation()}>
          <p className="text-sm font-medium text-fg">Name this preset</p>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel() }}
            placeholder="Artist — Song (version)"
            className="w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-4 outline-none focus:border-primary/50"
          />
          <div className="flex gap-2">
            <button onClick={onCancel} className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-fg-3 hover:text-fg transition-colors">Cancel</button>
            <button onClick={commit} disabled={!name.trim()} className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-40 transition-colors">Save</button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── QR Modal ─────────────────────────────────────────────────────────────────

const GENERIC_PRESET_NAMES = ['imported preset', 'import preset', 'my preset', 'new preset', 'preset 1', 'preset']

function isGenericName(name: string) {
  return GENERIC_PRESET_NAMES.includes(name.toLowerCase().trim())
}

function QrModal({ item, currentDevice, onClose, onDeleteRequest, onRename, onOpen, onConvert, autoRename }: {
  item: HistoryItem
  currentDevice: NuxDevice
  onClose: () => void
  onDeleteRequest: () => void
  onRename: (name: string) => void
  onOpen: () => void
  onConvert: (converted: QrResult) => void
  autoRename?: boolean
}) {
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [editing, setEditing] = useState(autoRename ?? false)
  const [name, setName] = useState(item.qr.presetName)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const download = useQrDownload(canvasRef, name)
  const { share, shareLabel } = useQrShare(canvasRef, item.qr.presetName)

  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(item.qr.presetName + ' guitar tone')}`

  const commitRename = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== item.qr.presetName) onRename(trimmed)
    setEditing(false)
  }

  useEffect(() => {
    if (editing) nameInputRef.current?.focus()
  }, [editing])

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up overflow-hidden flex flex-col max-h-[90svh]" onClick={e => e.stopPropagation()}>

          {/* QR Image */}
          <div className="relative flex justify-center bg-white p-4 shrink-0">
            <button
              onClick={onClose}
              className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/15 hover:bg-black/30 text-black/50 hover:text-black/80 transition-colors"
            >
              <CloseIcon />
            </button>
            <QrImage ref={canvasRef} imageBase64={item.qr.imageBase64} presetName={name} deviceName={item.qr.deviceName}/>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
            <div>
              {editing ? (
                <input
                  ref={nameInputRef}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') { setName(item.qr.presetName); setEditing(false) }
                  }}
                  className="w-full rounded-lg border border-primary/50 bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg outline-none"
                />
              ) : (
                <button onClick={() => setEditing(true)} className="text-left group">
                  <p className="text-sm font-medium text-fg group-hover:text-primary transition-colors">
                    {name} <span className="text-[10px] text-fg-4 group-hover:text-fg-3">rename</span>
                  </p>
                </button>
              )}
              <p className="text-xs text-fg-3 mt-0.5">{item.qr.deviceName}</p>
              {item.qr.importNote && (
                <p className="text-xs text-fg-4 italic mt-1">"{item.qr.importNote}"</p>
              )}
            </div>

            <div className="space-y-2">
              <button onClick={onOpen} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-on-primary hover:opacity-90 active:opacity-80 transition-colors shadow-sm">
                Open in chat
              </button>
              {(item.qr.deviceId ? item.qr.deviceId !== currentDevice : item.qr.deviceName !== (NUX_DEVICES.find(d => d.id === currentDevice)?.label ?? currentDevice)) && (() => {
                const label = NUX_DEVICES.find(d => d.id === currentDevice)?.label ?? currentDevice
                return (
                  <button
                    onClick={async () => {
                      setConverting(true)
                      setConvertError(null)
                      try {
                        const result = await convertPreset(item.qr.qrString, currentDevice, item.qr.presetName)
                        if (result) onConvert(result)
                        else setConvertError('Conversion failed — try again.')
                      } catch (e) { setConvertError(e instanceof Error ? e.message : 'Conversion failed.') } finally { setConverting(false) }
                    }}
                    disabled={converting}
                    className="w-full rounded-xl border border-white/10 py-2.5 text-sm font-medium text-fg-3 hover:border-white/20 hover:text-fg disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {converting && <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                    {converting ? 'Converting…' : `Convert to ${label}`}
                  </button>
                )
              })()}
              {convertError && <p className="text-xs text-red-400 text-center">{convertError}</p>}
            </div>

            <div className="grid grid-cols-4 gap-2">
              <button onClick={download} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                <DownloadIcon /> Save
              </button>
              <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                <YoutubeIcon /> YT
              </a>
              <button onClick={share} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                <FacebookIcon /> {shareLabel}
              </button>
              <button
                onClick={() => { if (item.qr.qrString) { navigator.clipboard.writeText(item.qr.qrString); setCopied(true); setTimeout(() => setCopied(false), 2000) } }}
                disabled={!item.qr.qrString}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors disabled:opacity-40"
              >
                <CopyIcon /> {copied ? '✓' : 'Copy'}
              </button>
            </div>

            <div className="border-t border-white/10 pt-3">
              <button onClick={() => setSettingsOpen(o => !o)} className="flex w-full items-center justify-between text-xs text-fg-3 hover:text-fg transition-colors">
                <span>Tone settings</span>
                <ChevronIcon open={settingsOpen} />
              </button>
              <div className={`grid transition-all duration-200 ease-in-out ${settingsOpen ? 'grid-rows-[1fr] mt-2' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className="space-y-1.5">
                    {item.qr.settings.map((slot, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${slot.enabled ? 'bg-green-400' : 'bg-fg-4'}`} />
                        <div className="min-w-0">
                          <span className="text-[11px] text-fg-3">{slot.slot}: </span>
                          <span className="text-[11px] text-fg">{slot.selection}</span>
                          {slot.params && Object.keys(slot.params).length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-x-3">
                              {Object.entries(slot.params).slice(0, 4).map(([k, v]) => (
                                <span key={k} className="text-[10px] text-fg-4">{k}: {v}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <button onClick={onDeleteRequest} className="flex w-full items-center justify-center gap-1.5 py-1.5 text-xs text-fg-4 hover:text-fg-2 transition-colors">
              <TrashIcon /> Delete preset
            </button>
          </div>

        </div>
      </div>
    </>
  )
}

// ─── Chat QR Modal ────────────────────────────────────────────────────────────

function ChatQrModal({ qr, description, currentDevice, onClose, onConvert }: {
  qr: QrResult; description: string; currentDevice: NuxDevice; onClose: () => void
  onConvert?: (converted: QrResult) => void
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [converting, setConverting] = useState(false)
  const [name, setName] = useState(qr.presetName)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const download = useQrDownload(canvasRef, name)
  const { share, shareLabel } = useQrShare(canvasRef, name)
  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' guitar tone')}`

  useEffect(() => { if (editing) nameInputRef.current?.focus() }, [editing])

  const commitName = () => {
    const trimmed = name.trim()
    if (!trimmed) setName(qr.presetName)
    else setName(trimmed)
    setEditing(false)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up overflow-hidden flex flex-col max-h-[90svh]" onClick={e => e.stopPropagation()}>

          {/* QR Image */}
          <div className="relative flex justify-center bg-white p-4 shrink-0">
            <button
              onClick={onClose}
              className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/15 hover:bg-black/30 text-black/50 hover:text-black/80 transition-colors"
            >
              <CloseIcon />
            </button>
            <QrImage ref={canvasRef} imageBase64={qr.imageBase64} presetName={name} deviceName={qr.deviceName}/>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
            <div>
              {editing ? (
                <input
                  ref={nameInputRef}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitName()
                    if (e.key === 'Escape') { setName(qr.presetName); setEditing(false) }
                  }}
                  className="w-full rounded-lg border border-primary/50 bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg outline-none"
                />
              ) : (
                <button onClick={() => setEditing(true)} className="text-left group">
                  <p className="text-sm font-medium text-fg group-hover:text-primary transition-colors">
                    {name} <span className="text-[10px] text-fg-4 group-hover:text-fg-3">rename</span>
                  </p>
                </button>
              )}
              <p className="text-xs text-fg-3 mt-0.5">{qr.deviceName}</p>
              {description && (() => {
                const excerpt = description
                  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
                  .replace(/#{1,6}\s+[^\n]*/g, '')
                  .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
                  .replace(/`[^`]+`/g, '')
                  .replace(/\[[^\]]*\]\([^)]*\)/g, '')
                  .split('\n').map(l => l.trim()).filter(Boolean)[0] ?? ''
                // Strip if it's just the preset name quoted back
                const stripped = excerpt.replace(/^[""]([^""]+)[""][—–-]?\s*/u, '').trim()
                const effective = stripped.length > 20 ? stripped : excerpt.startsWith('"') || excerpt.startsWith('\u201c') ? '' : excerpt
                const short = effective.length > 160 ? effective.slice(0, 157) + '…' : effective
                return short ? <p className="text-[11px] text-fg-4 leading-relaxed mt-2">{short}</p> : null
              })()}
            </div>

            <div className="space-y-2">
              {(qr.deviceId ? qr.deviceId !== currentDevice : qr.deviceName !== (NUX_DEVICES.find(d => d.id === currentDevice)?.label ?? currentDevice)) && onConvert && (() => {
                const label = NUX_DEVICES.find(d => d.id === currentDevice)?.label ?? currentDevice
                return (
                  <button
                    onClick={async () => {
                      setConverting(true)
                      try {
                        const result = await convertPreset(qr.qrString, currentDevice, qr.presetName)
                        if (result) onConvert(result)
                      } catch { /* ignore */ } finally { setConverting(false) }
                    }}
                    disabled={converting}
                    className="w-full rounded-xl border border-white/10 py-2.5 text-sm font-medium text-fg-3 hover:border-white/20 hover:text-fg disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {converting && <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                    {converting ? 'Converting…' : `Convert to ${label}`}
                  </button>
                )
              })()}
            </div>

            <div className="grid grid-cols-4 gap-2">
              <button onClick={download} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                <DownloadIcon /> Save
              </button>
              <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                <YoutubeIcon /> YT
              </a>
              <button onClick={share} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                <FacebookIcon /> {shareLabel}
              </button>
              <button
                onClick={() => { if (qr.qrString) { navigator.clipboard.writeText(qr.qrString); setCopied(true); setTimeout(() => setCopied(false), 2000) } }}
                disabled={!qr.qrString}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2.5 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors disabled:opacity-40"
              >
                <CopyIcon /> {copied ? '✓' : 'Copy'}
              </button>
            </div>

            <div className="border-t border-white/10 pt-3">
              <button onClick={() => setSettingsOpen(o => !o)} className="flex w-full items-center justify-between text-xs text-fg-3 hover:text-fg transition-colors">
                <span>Tone settings</span>
                <ChevronIcon open={settingsOpen} />
              </button>
              <div className={`grid transition-all duration-200 ease-in-out ${settingsOpen ? 'grid-rows-[1fr] mt-2' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className="space-y-1.5">
                    {qr.settings.map((slot, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${slot.enabled ? 'bg-green-400' : 'bg-fg-4'}`} />
                        <div className="min-w-0">
                          <span className="text-[11px] text-fg-3">{slot.slot}: </span>
                          <span className="text-[11px] text-fg">{slot.selection}</span>
                          {slot.params && Object.keys(slot.params).length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-x-3">
                              {Object.entries(slot.params).slice(0, 4).map(([k, v]) => (
                                <span key={k} className="text-[10px] text-fg-4">{k}: {v}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

// ─── Device Mismatch Modal ───────────────────────────────────────────────────

function DeviceMismatchModal({ qr, targetDevice, onConvert, onSaveOriginal, onClose, converting }: {
  qr: QrResult; targetDevice: NuxDevice; onConvert: () => void; onSaveOriginal: () => void; onClose: () => void; converting: boolean
}) {
  const targetLabel = NUX_DEVICES.find(d => d.id === targetDevice)?.label ?? targetDevice
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up p-6 space-y-4" onClick={e => e.stopPropagation()}>
          <div>
            <p className="text-sm font-semibold text-fg">Device mismatch</p>
            <p className="text-xs text-fg-3 mt-1.5">This preset is for <span className="text-fg">{qr.deviceName}</span>, but your device is <span className="text-fg">{targetLabel}</span>.</p>
          </div>
          <div className="space-y-2">
            <button onClick={onConvert} disabled={converting} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {converting && <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
              {converting ? 'Converting…' : `Convert to ${targetLabel}`}
            </button>
            <button onClick={onSaveOriginal} disabled={converting} className="w-full rounded-xl border border-white/10 py-2.5 text-sm font-medium text-fg-3 hover:border-white/20 hover:text-fg disabled:opacity-50 transition-colors">
              Save original
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Import Toast ─────────────────────────────────────────────────────────────

// ─── About Modal ──────────────────────────────────────────────────────────────

const WHATS_NEW: { version: string; items: { text: string; sub?: string }[] }[] = [
  {
    version: '1.8.1',
    items: [
      { text: 'Housekeeping — repo moved to the Cordfuse org on GitHub' },
    ],
  },
  {
    version: '1.8.0',
    items: [
      {
        text: 'MkII amps now supported — 20BT MkII, 40BT MkII, 60BT MkII',
        sub: 'All three NGA-series MkII combo amps now generate correct 113-byte Pro-format QR codes. Previously users with these amps were getting codes that wouldn\'t load.',
      },
      { text: 'Mighty Go support added — NUX NGA-5 portable amp (QR ID 10)' },
      { text: 'Mighty 40BT gets its own entry — was incorrectly grouped under the 20BT ID' },
    ],
  },
  {
    version: '1.7.2',
    items: [
      {
        text: 'Mighty 20BT/40BT label clarified — original model only',
        sub: 'Picker warning added for MkII users. MkII support now ships in v1.8.0.',
      },
    ],
  },
  {
    version: '1.7',
    items: [
      { text: 'Faster responses — prompt caching cuts AI processing time on follow-up turns' },
      { text: 'New QR card style — dark theme with red accents, matches the desktop app look' },
      { text: 'Cleaner layout — quota and settings moved to the sidebar footer' },
    ],
  },
  {
    version: '1.6',
    items: [
      { text: 'Free tier only — no API keys needed, just open and play' },
      { text: 'Anthropic native web search — faster, no third-party dependency' },
      { text: 'Copy button on all QR popups — grab the raw preset code with one tap' },
      { text: 'Simpler: one AI provider, one search engine, one less thing to configure' },
    ],
  },
  {
    version: '1.5',
    items: [
      {
        text: 'All 10 NUX MightyAmp models supported — every device in the lineup now works',
        sub: 'Plug Pro · Space · Lite MkII · 8BT MkII · Mighty Air · Plug v1 · Plug v2 · Lite BT · 8BT · 20/40BT',
      },
      { text: 'Import any NUX QR code — scan or upload a photo to decode and refine it' },
      { text: 'Convert presets between devices with one tap' },
      { text: 'Generated QR codes save to your collection automatically' },
      { text: 'Bass tones — dedicated bass presets with the right amps, cabs, and effects' },
      { text: 'Sidebar search — filter your chats and QR codes as you type' },
      { text: 'Web search — AI looks up real gear data for song and artist tone references' },
    ],
  },
]

function AboutModal({ onClose }: { onClose: () => void }) {
  const [openVersions, setOpenVersions] = useState<Record<string, boolean>>({ [WHATS_NEW[0].version]: true })
  const toggle = (v: string) => setOpenVersions(prev => ({ ...prev, [v]: !prev[v] }))
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface shadow-2xl animate-scale-up p-6 space-y-5 max-h-[90vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <img src="/icons/icon-192.png" alt="Mighty AI QR" className="h-12 w-12 rounded-xl shrink-0" />
              <div>
                <p className="text-sm font-semibold text-fg">Mighty AI QR <span className="text-[11px] font-normal text-fg-4">v{pkg.version}</span></p>
                <p className="text-[11px] text-fg-4 mt-1 leading-relaxed">
                  Describe a tone in plain English — get a scannable QR code for your NUX MightyAmp, instantly.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 text-fg-4 hover:text-fg transition-colors"><CloseIcon /></button>
          </div>

          {WHATS_NEW.map(({ version, items }) => {
            const open = !!openVersions[version]
            return (
              <div key={version} className="border-t border-white/10 pt-4">
                <button
                  onClick={() => toggle(version)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <p className="text-[11px] font-medium text-fg-3 uppercase tracking-wider">What&apos;s new in v{version}</p>
                  <ChevronIcon open={open} />
                </button>
                {open && (
                  <ul className="mt-2.5 space-y-2">
                    {items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-primary mt-px shrink-0">•</span>
                        <div>
                          <span className={i === 0 ? 'text-[11px] font-medium text-fg' : 'text-[11px] text-fg-4'}>{item.text}</span>
                          {item.sub && <p className="text-[10px] text-fg-4 mt-0.5">{item.sub}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}

          <div className="border-t border-white/10 pt-4 space-y-1">
            <p className="text-[11px] font-medium text-fg-3 uppercase tracking-wider">Author</p>
            <a href="https://github.com/steve-krisjanovs/mighty-ai-qr-web" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              github.com/steve-krisjanovs/mighty-ai-qr-web
            </a>
          </div>

          <div className="border-t border-white/10 pt-4 space-y-1">
            <p className="text-[11px] font-medium text-fg-3 uppercase tracking-wider">Credits</p>
            <p className="text-[11px] text-fg-4">QR format based on NUX MightyAmp. Special thanks to:</p>
            <a href="https://github.com/tuntorius/mightier_amp" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              github.com/tuntorius/mightier_amp
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Welcome Modal ────────────────────────────────────────────────────────────

const WELCOME_DEVICES = ['Plug Pro', 'Space', 'Lite MkII', '8BT MkII', '20BT MkII', '40BT MkII', '60BT MkII', 'Mighty Air', 'Plug v1', 'Plug v2', 'Lite BT', '8BT', '20BT/40BT', '40BT', 'Mighty Go']

function WelcomeModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm" />
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface shadow-2xl animate-scale-up overflow-hidden flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="relative bg-primary/10 border-b border-primary/20 px-6 pt-5 pb-4 text-center shrink-0">
            <img src="/icons/icon-192.png" alt="Mighty AI QR" className="h-12 w-12 rounded-xl mx-auto mb-3 shadow-lg" />
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-0.5">What&apos;s new</p>
            <h2 className="text-xl font-bold text-fg">Mighty AI QR 1.8.1</h2>
            <p className="text-xs text-fg-3 mt-0.5">MkII amp support + Mighty Go.</p>
          </div>

          {/* Body */}
          <div className="px-6 py-4 space-y-3 overflow-y-auto">

            {/* Highlight */}
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3">
              <p className="text-sm font-semibold text-fg mb-0.5">NGA MkII amps now work</p>
              <p className="text-[11px] text-fg-3">Mighty 20BT MkII, 40BT MkII, and 60BT MkII now generate correct QR codes. Also added Mighty Go (NGA-5) and fixed the Mighty 40BT — it was incorrectly grouped under the 20BT entry.</p>
            </div>

            {/* Feature list */}
            <ul className="space-y-2">
              {[
                { text: '20BT MkII, 40BT MkII, 60BT MkII — full Pro-format QR support (IDs 21, 22, 23)' },
                { text: 'Mighty Go (NGA-5) added — QR ID 10, PlugAir-compatible format' },
                { text: 'Mighty 40BT (original) gets its own entry — no longer shares ID 7 with the 20BT' },
              ].map(({ text }) => (
                <li key={text} className="flex items-start gap-2.5 text-[11px] text-fg-3 leading-relaxed">
                  <span className="shrink-0 text-primary leading-none mt-px">+</span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <div className="px-6 pb-5 pt-2 space-y-1.5 border-t border-white/10 shrink-0">
            <button
              onClick={onDismiss}
              className="w-full rounded-2xl bg-primary py-2.5 text-sm font-semibold text-on-primary hover:opacity-90 active:opacity-80 transition-opacity shadow-lg"
            >
              Let&apos;s go →
            </button>
            <button
              onClick={onDismiss}
              className="w-full py-1.5 text-[11px] text-fg-4 hover:text-fg-3 transition-colors"
            >
              Don&apos;t show again
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

const THEME_GROUPS: { label: string; ids: Theme[] }[] = [
  { label: 'Standard', ids: ['dark', 'oled', 'light'] },
  { label: 'Dark Vintage', ids: ['tweed', 'amber', 'british', 'oxblood', 'silver', 'pedalboard', 'blackface', 'plexi'] },
  { label: 'Light Vintage', ids: ['tweed-lt', 'amber-lt', 'british-lt', 'oxblood-lt', 'silver-lt', 'pedalboard-lt', 'blackface-lt', 'plexi-lt'] },
]

function QuotaPill({ quotaVersion }: { quotaVersion: number }) {
  const [remaining, setRemaining] = useState<number | null>(null)
  const fetchQuota = useCallback(() => {
    fetch('/api/quota').then(r => r.json()).then(d => { setRemaining(d.remaining) }).catch(() => {})
  }, [])
  useEffect(() => { fetchQuota() }, [fetchQuota, quotaVersion])
  useEffect(() => {
    const id = setInterval(fetchQuota, 30_000)
    return () => clearInterval(id)
  }, [fetchQuota])
  if (remaining === null) return null
  const low = remaining <= 10
  return (
    <div className={`flex items-center rounded-xl border px-2.5 h-8 text-xs font-medium select-none ${low ? 'border-red-500/40 text-red-400' : 'border-white/10 bg-surface-2 text-fg-4'}`}>
      {remaining} left
    </div>
  )
}


function SettingsPanel({ onClose, hintDismissed, onHintDismissedChange }: { onClose: () => void; hintDismissed: boolean; onHintDismissedChange: (v: boolean) => void }) {
  const [closing, setClosing] = useState(false)
  const [isPwa] = useState(() => typeof window !== 'undefined' && 'serviceWorker' in navigator && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true))
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'done'>('idle')
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme())
  const [themeOpen, setThemeOpen] = useState(false)
  const [currentDevice, setCurrentDevice] = useState<NuxDevice>(() => getDefaultDevice())
  const [deviceOpen, setDeviceOpen] = useState(false)

  const applyTheme = (t: Theme) => {
    setCurrentTheme(t)
    document.documentElement.dataset.theme = t
    saveTheme(t)
  }

  const applyDevice = (d: NuxDevice) => {
    setCurrentDevice(d)
    saveDefaultDevice(d)
  }

  const handleClose = () => {
    setClosing(true)
    setTimeout(() => onClose(), 240)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={handleClose} />
      <aside className={`fixed right-0 top-0 z-50 flex h-full w-80 flex-col bg-surface shadow-2xl ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-medium text-fg">Settings</h2>
          <button onClick={handleClose} className="text-fg-3 hover:text-fg transition-colors">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Theme */}
          <div>
            <p className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">Theme</p>
            <div className="relative">
              {(() => { const active = THEMES.find(t => t.id === currentTheme)!; return (
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
                  <span className="text-xs text-fg-4">{active.desc}</span>
                  <ChevronIcon open={themeOpen} />
                </button>
              )})()}
              {themeOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setThemeOpen(false)} />
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden">
                    {THEME_GROUPS.map(group => (
                      <div key={group.label}>
                        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-4">{group.label}</p>
                        {group.ids.map(id => {
                          const t = THEMES.find(x => x.id === id)!
                          return (
                            <button
                              key={t.id}
                              onClick={() => { applyTheme(t.id); setThemeOpen(false) }}
                              className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                                currentTheme === t.id ? 'text-primary bg-primary/10' : 'text-fg-2 hover:bg-surface-3 hover:text-fg'
                              }`}
                            >
                              <div className="flex gap-1 shrink-0">
                                <div style={{ background: t.bg }} className="h-3 w-3 rounded-sm border border-white/10" />
                                <div style={{ background: t.primary }} className="h-3 w-3 rounded-sm" />
                                <div style={{ background: t.fg, opacity: 0.7 }} className="h-3 w-3 rounded-sm" />
                              </div>
                              <span className="flex-1 text-left">{t.label}</span>
                              <span className="text-xs opacity-50">{t.desc}</span>
                              {currentTheme === t.id && <span className="ml-auto text-primary shrink-0">✓</span>}
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

          {/* Default NUX Device */}
          <div>
            <p className="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">Default NUX Device</p>
            <div className="relative">
              {(() => { const active = NUX_DEVICES.find(d => d.id === currentDevice)!; return (
                <button
                  onClick={() => setDeviceOpen(o => !o)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-surface-2 px-3 py-2.5 text-sm text-fg hover:bg-surface-3 transition-colors"
                >
                  <span className="flex-1 text-left">{active.label}</span>
                  <ChevronIcon open={deviceOpen} />
                </button>
              )})()}
              {deviceOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDeviceOpen(false)} />
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/10 bg-surface-2 shadow-xl overflow-hidden">
                    {NUX_DEVICES.map(d => (
                      <button
                        key={d.id}
                        onClick={() => { applyDevice(d.id); setDeviceOpen(false) }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                          currentDevice === d.id ? 'text-primary bg-primary/10' : 'text-fg-2 hover:bg-surface-3 hover:text-fg'
                        }`}
                      >
                        <span className="flex-1 text-left">{d.label}</span>
                        {currentDevice === d.id && <span className="ml-auto text-primary shrink-0">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Free tier hint */}
          <div className="flex cursor-pointer items-center justify-between gap-3" onClick={() => { const next = !hintDismissed; saveHintDismissed(next); onHintDismissedChange(next) }}>
            <span className="text-xs text-fg-3">Show daily limit hint in chat</span>
            <div
              role="switch"
              aria-checked={!hintDismissed}
              className={`relative h-5 w-9 rounded-full transition-colors ${!hintDismissed ? 'bg-primary' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${!hintDismissed ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </div>

          {/* Check for updates — PWA only */}
          {isPwa && (
            <button
              onClick={async () => {
                setUpdateStatus('checking')
                try {
                  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                  const reg = await Promise.race([navigator.serviceWorker.ready, timeout])
                  await Promise.race([reg.update(), timeout])
                  setUpdateStatus('done')
                  setTimeout(() => setUpdateStatus('idle'), 2500)
                } catch {
                  setUpdateStatus('idle')
                }
              }}
              disabled={updateStatus === 'checking'}
              className="w-full rounded-lg border border-white/10 py-2.5 text-sm text-fg-3 hover:text-fg hover:border-white/20 transition-colors disabled:opacity-50"
            >
              {updateStatus === 'checking' ? 'Checking…' : updateStatus === 'done' ? 'Up to date' : 'Check for updates'}
            </button>
          )}

          {/* About */}
          <div className="border-t border-white/10 pt-4">
            <button
              onClick={() => setShowAboutModal(true)}
              className="flex w-full items-center justify-between hover:text-fg transition-colors"
            >
              <span className="text-xs font-medium text-fg-3 uppercase tracking-wider">About</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-fg-4">v{pkg.version}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              </div>
            </button>
          </div>
          {showAboutModal && <AboutModal onClose={() => setShowAboutModal(false)} />}
        </div>
      </aside>
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function QrDeviceGroup({ deviceName, items, collapsed, onToggle, onQrSelect, onClose, onDeleteRequest, onRenameQr, onQrDelete }: {
  deviceName: string
  items: HistoryItem[]
  collapsed: boolean
  onToggle: () => void
  onQrSelect: (item: HistoryItem) => void
  onClose: () => void
  onDeleteRequest: (label: string, onConfirm: () => void) => void
  onRenameQr: (id: string, name: string) => void
  onQrDelete: (id: string) => void
}) {
  const downloadZip = () => downloadQrZip(items, `${deviceName.replace(/[^a-z0-9_\-. ]/gi, '_')}-qr-codes.zip`)

  return (
    <div>
      <div className="flex w-full items-center px-3 pt-3 pb-1 sticky top-0 z-10 bg-surface gap-1">
        <button onClick={onToggle} className="flex flex-1 items-center gap-1 min-w-0 text-left">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-fg-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-4 truncate">{deviceName}</span>
        </button>
        <button onClick={downloadZip} title="Download all as ZIP" className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>
      {!collapsed && items.map(item => (
        <QrHistoryItem
          key={item.id}
          item={item}
          onOpen={() => { onQrSelect(item); onClose() }}
          onDeleteRequest={() => onDeleteRequest(item.presetName, () => onQrDelete(item.id))}
          onRename={name => onRenameQr(item.id, name)}
        />
      ))}
    </div>
  )
}

function QrHistoryItem({ item, onOpen, onDeleteRequest, onRename }: {
  item: HistoryItem; onOpen: () => void; onDeleteRequest: () => void; onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.presetName)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPress = useLongPress(() => { setName(item.presetName); setEditing(true); requestAnimationFrame(() => inputRef.current?.focus()) })

  const commit = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== item.presetName) onRename(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex w-full items-center gap-2 px-3 py-2.5 bg-surface-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white p-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imageBase64} alt={item.presetName} className="h-full w-full object-contain" />
        </div>
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
    <div className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-surface-2 transition-colors" {...longPress}>
      <button onClick={onOpen} className="flex flex-1 items-center gap-3 min-w-0 text-left">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white p-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imageBase64} alt={item.presetName} className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-fg">{item.presetName}</p>
          <p className="text-[10px] text-fg-4">{relativeTime(item.timestamp)}</p>
        </div>
      </button>
      <button onClick={e => { e.stopPropagation(); onDeleteRequest() }} className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors">
        <TrashIcon />
      </button>
    </div>
  )
}

function Sidebar({
  conversations, activeId, onSelect, onNew, onDelete, onRenameConv, qrHistory, onQrSelect, onQrDelete, onRenameQr, onDeleteRequest, visible, collapsed, onClose, onCollapse, onQrImported, onSettings, onDeleteAllChats, onDeleteAllQr,
}: {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRenameConv: (id: string, name: string) => void
  qrHistory: HistoryItem[]
  onQrSelect: (item: HistoryItem) => void
  onQrDelete: (id: string) => void
  onRenameQr: (id: string, name: string) => void
  onDeleteRequest: (label: string, onConfirm: () => void) => void
  visible: boolean
  collapsed: boolean
  onClose: () => void
  onCollapse: () => void
  onQrImported: (file: File) => void
  onSettings: () => void
  onDeleteAllChats: () => void
  onDeleteAllQr: () => void
}) {
  const [tab, setTab] = useState<'chats' | 'qr'>('qr')
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const scanInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const prevQrCount = useRef(qrHistory.length)
  useEffect(() => {
    if (qrHistory.length > prevQrCount.current) { setQuery(''); setTab('qr') }
    prevQrCount.current = qrHistory.length
  }, [qrHistory.length])

  const q = query.toLowerCase()
  const filteredConvs = q ? conversations.filter(c => c.title.toLowerCase().includes(q)) : conversations
  const filteredQr = q ? qrHistory.filter(i => i.presetName.toLowerCase().includes(q) || (i.deviceName || '').toLowerCase().includes(q)) : qrHistory

  const toggleGroup = (name: string) => setCollapsedGroups(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const buildGroups = (items: HistoryItem[]) => {
    const groups = new Map<string, HistoryItem[]>()
    for (const item of items) {
      const key = item.deviceName || item.qr.deviceName || 'Unknown Device'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item)
    }
    for (const g of groups.values()) g.sort((a, b) => b.timestamp - a.timestamp)
    return [...groups.entries()].sort((a, b) => b[1][0].timestamp - a[1][0].timestamp)
  }

  const groups = buildGroups(filteredQr)
  const allCollapsed = groups.length > 0 && groups.every(([name]) => collapsedGroups.has(name))
  const toggleAll = () => {
    if (allCollapsed) setCollapsedGroups(new Set())
    else setCollapsedGroups(new Set(groups.map(([name]) => name)))
  }

  return (
    <>
      {visible && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />
      )}
      <aside className={`
        fixed top-0 left-0 z-50 h-full bg-surface shadow-[4px_0_16px_rgba(0,0,0,0.35)]
        flex flex-col overflow-hidden transition-[transform,width] duration-200
        lg:relative
        ${visible ? 'translate-x-0 w-[260px]' : '-translate-x-full w-[260px]'}
        ${collapsed ? 'lg:w-0 lg:translate-x-0' : 'lg:w-[260px] lg:translate-x-0'}
      `}>
        <div className="flex items-center justify-between px-3 py-3 shrink-0 min-w-[260px]">
          <div className="flex items-center gap-2.5">
            <AppIcon />
            <span className="text-sm font-medium text-fg whitespace-nowrap">Mighty AI QR</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg transition-colors lg:hidden">
              <CloseIcon />
            </button>
            <button onClick={onCollapse} title="Collapse sidebar" className="hidden lg:flex h-7 w-7 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          </div>
        </div>

        <div className="flex items-center border-b border-white/10 ml-3 mr-[17px]">
          {(['qr', 'chats'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === t ? 'border-primary text-primary' : 'border-transparent text-fg-3 hover:text-fg-2'
              }`}
            >
              {t === 'chats' ? 'Chats' : 'QR Codes'}
            </button>
          ))}
          <div className="flex items-center justify-end w-24 shrink-0">
            {tab === 'chats' && conversations.length > 0 && (
              <button onClick={onDeleteAllChats} title="Delete all chats" className="flex h-7 w-7 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors">
                <TrashIcon />
              </button>
            )}
            {tab === 'qr' && qrHistory.length > 0 && (
              <>
                <button
                  onClick={toggleAll}
                  title={allCollapsed ? 'Expand all' : 'Collapse all'}
                  className="flex h-7 w-7 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {allCollapsed
                      ? <><polyline points="6 9 12 15 18 9"/><polyline points="6 15 12 21 18 15"/></>
                      : <><polyline points="18 15 12 9 6 15"/><polyline points="18 9 12 3 6 9"/></>
                    }
                  </svg>
                </button>
                <button
                  onClick={() => downloadQrZip(qrHistory, 'all-qr-codes.zip')}
                  title="Download all QR codes as ZIP"
                  className="flex h-7 w-7 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button onClick={onDeleteAllQr} title="Delete all QR codes" className="flex h-7 w-7 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors">
                  <TrashIcon />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="px-3 pt-2 pb-1 shrink-0 min-w-[260px]">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-4 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tab === 'chats' ? 'Search chats…' : 'Search presets…'}
              className="w-full rounded-lg bg-surface-2 py-1.5 pl-7 pr-7 text-xs text-fg placeholder:text-fg-4 outline-none focus:ring-1 focus:ring-primary/40"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-4 hover:text-fg-2 transition-colors">
                <CloseIcon />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 [scrollbar-gutter:stable]">
          {tab === 'chats' ? (
            filteredConvs.length === 0
              ? <p className="px-4 py-6 text-center text-xs text-fg-4">{query ? 'No matches' : 'No conversations yet'}</p>
              : filteredConvs.map(conv => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  onSelect={() => { onSelect(conv.id); onClose() }}
                  onDeleteRequest={() => onDeleteRequest(conv.title, () => onDelete(conv.id))}
                  onRename={name => onRenameConv(conv.id, name)}
                />
              ))
          ) : (
            <>
              <input ref={scanInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { onQrImported(f); e.target.value = '' } }} />
              <input ref={importInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { onQrImported(f); e.target.value = '' } }} />
              <div className="px-3 pb-2 flex gap-2">
                <button onClick={() => scanInputRef.current?.click()} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                  <CameraIcon /> Scan
                </button>
                <button onClick={() => importInputRef.current?.click()} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 py-2 text-xs text-fg-3 hover:text-fg hover:border-white/20 transition-colors">
                  <UploadIcon /> Import
                </button>
              </div>
              {filteredQr.length === 0
                ? <p className="px-4 py-4 text-center text-xs text-fg-4">{query ? 'No matches' : 'No QR codes yet'}</p>
                : groups.map(([deviceName, items]) => (
                    <QrDeviceGroup
                      key={deviceName}
                      deviceName={deviceName}
                      items={items}
                      collapsed={collapsedGroups.has(deviceName)}
                      onToggle={() => toggleGroup(deviceName)}
                      onQrSelect={onQrSelect}
                      onClose={onClose}
                      onDeleteRequest={onDeleteRequest}
                      onRenameQr={onRenameQr}
                      onQrDelete={onQrDelete}
                    />
                  ))
              }
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function ConvItem({ conv, active, onSelect, onDeleteRequest, onRename }: {
  conv: Conversation; active: boolean; onSelect: () => void; onDeleteRequest: () => void; onRename: (name: string) => void
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
      >
        <PencilIcon />
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDeleteRequest() }}
        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center text-fg-4 hover:text-fg-2 transition-colors"
      >
        <TrashIcon />
      </button>
    </div>
  )
}

// ─── BYOK Hint Banner ─────────────────────────────────────────────────────────

function ByokHintBanner({ onDismiss, onOpenSettings }: { onDismiss: () => void; onOpenSettings: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-xs text-fg-3 animate-fade-in">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <span className="flex-1">Using shared free tier. <button onClick={onOpenSettings} className="text-primary hover:underline">Add your own API key</button> for unlimited use — Anthropic gives free credits on signup.</span>
      <button onClick={onDismiss} className="shrink-0 text-fg-4 hover:text-fg-2 transition-colors" aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  )
}

// ─── Suggestion Screen ────────────────────────────────────────────────────────

const BASS_CHIP = "I'm a bassist — what artist or song should we start with?"

function SuggestionScreen({ onSend }: { onSend: (text: string) => void }) {
  const [current, setCurrent] = useState<string[]>(ALL_SUGGESTIONS.slice(0, 6))
  useEffect(() => { setCurrent(getRandomSuggestions(6)) }, [])
  const next = () => setCurrent(prev => getRandomSuggestions(6, prev))
  return (
    <div className="flex h-full flex-col justify-end animate-fade-in pb-2 gap-3">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3 text-sm text-fg">
        What tone are you after? Describe an artist, song, genre, or mood and I&apos;ll dial it in.
      </div>
      <div className="flex flex-wrap gap-2">
        {current.map(s => (
          <button key={s} onClick={() => onSend(s)} className="rounded-full border border-white/10 bg-surface-2 px-3 py-1.5 text-xs text-fg-3 hover:border-white/20 hover:text-fg transition-colors">{s}</button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={next} className="text-[11px] text-fg-4 hover:text-fg-3 transition-colors">
          More suggestions →
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-fg-4">Playing bass? Get started here:</p>
        <button
          onClick={() => onSend(BASS_CHIP)}
          className="self-start rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          {BASS_CHIP}
        </button>
      </div>
    </div>
  )
}

// ─── Sources Bar ──────────────────────────────────────────────────────────────

function SourcesBar({ sources }: { sources: { title: string; url: string }[] }) {
  const [open, setOpen] = useState(false)
  const getDomain = (url: string) => { try { return new URL(url).hostname } catch { return '' } }
  return (
    <div className="mt-2 animate-fade-in">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs text-fg-4 hover:text-fg-2 transition-colors"
      >
        <div className="flex -space-x-1.5">
          {sources.slice(0, 5).map((s, i) => (
            <img
              key={i}
              src={`https://www.google.com/s2/favicons?domain=${getDomain(s.url)}&sz=16`}
              width={16} height={16}
              className="rounded-sm ring-1 ring-surface-2 bg-surface-3"
              alt=""
            />
          ))}
        </div>
        <span>{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-0.5">
          {sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-fg-3 hover:bg-surface-3 hover:text-fg transition-colors"
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${getDomain(s.url)}&sz=16`}
                width={16} height={16}
                className="rounded-sm shrink-0"
                alt=""
              />
              <span className="truncate">{s.title || getDomain(s.url)}</span>
              <span className="ml-auto shrink-0 text-fg-4">{getDomain(s.url)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Message Row ──────────────────────────────────────────────────────────────

function MessageRow({ msg, idx, active, onActivate, onDismiss, onEdit, onDelete, onQrOpen, disabled }: {
  msg: ChatMessage
  idx: number
  active: boolean
  onActivate: () => void
  onDismiss: () => void
  onEdit: (idx: number) => void
  onDelete: (idx: number) => void
  onQrOpen: (qr: QrResult, description: string) => void
  disabled?: boolean
}) {
  const longPress = useLongPress(disabled ? () => {} : onActivate)
  const actionsVisible = active && !disabled
  const actionClass = `flex gap-3 transition-opacity duration-150 mb-0.5 ${actionsVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className={`group flex flex-col animate-slide-in-bottom ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
      {msg.role === 'user' ? (
        <div className="flex items-end gap-1.5">
          {!disabled && (
            <div className={actionClass} onClick={e => e.stopPropagation()}>
              <button onClick={copy} title="Copy" className="text-fg-4 hover:text-fg-2 transition-colors">
                {copied ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
              </button>
              <button onClick={() => { onEdit(idx); onDismiss() }} title="Edit & resend" className="text-fg-4 hover:text-fg-2 transition-colors">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button onClick={() => { onDelete(idx); onDismiss() }} title="Delete" className="text-fg-4 hover:text-red-400 transition-colors">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          )}
          <div
            {...longPress}
            className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-on-primary select-none"
          >
            {msg.content}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-1.5">
            <div
              {...longPress}
              className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3 select-none"
            >
              <div className="prose-ai">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              </div>
            </div>
            {!disabled && (
              <div className={actionClass} onClick={e => e.stopPropagation()}>
                <button onClick={copy} title="Copy" className="text-fg-4 hover:text-fg-2 transition-colors">
                  {copied ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
                </button>
                <button onClick={() => { onDelete(idx); onDismiss() }} title="Delete" className="text-fg-4 hover:text-red-400 transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </div>
            )}
          </div>
          {msg.sources && msg.sources.length > 0 && <SourcesBar sources={msg.sources} />}
          {msg.qr && (
            <div className="mt-2 animate-fade-in space-y-2">
              <button
                onClick={() => onQrOpen(msg.qr!, msg.content)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface-3 px-4 py-2 text-sm text-fg hover:bg-surface-2 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/>
                  <rect width="5" height="5" x="3" y="16" rx="1"/>
                  <path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1"/>
                </svg>
                View QR code
                {msg.qr!.deviceName && <span className="text-fg-4 text-xs">· {msg.qr!.deviceName}</span>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Page() {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [currentQr, setCurrentQr] = useState<QrResult | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showErrorExplain, setShowErrorExplain] = useState(false)
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [qrHistory, setQrHistory] = useState<HistoryItem[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showWelcome, setShowWelcome] = useState(() => !getWelcomeSeen(pkg.version))
  const [settingsVersion, setSettingsVersion] = useState(0)
  const [quotaVersion, setQuotaVersion] = useState(0)
  const [currentDevice, setCurrentDevice] = useState<NuxDevice>(() => getDefaultDevice())
  const [hintDismissed, setHintDismissed] = useState(() => getHintDismissed())
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null)
  const [pendingImport, setPendingImport] = useState<{ qr: QrResult; guess: { artist: string; song: string } } | null>(null)
  const [importNamePending, setImportNamePending] = useState<{ qr: QrResult; suggestedName: string } | null>(null)
  const [deviceMismatchPending, setDeviceMismatchPending] = useState<{ qr: QrResult } | null>(null)
  const [deviceMismatchConverting, setDeviceMismatchConverting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ label: string; onConfirm: () => void } | null>(null)
  const [deviceChangedHint, setDeviceChangedHint] = useState(false)
  const [popupQr, setPopupQr] = useState<{ qr: QrResult; description: string } | null>(null)

  const requestDelete = useCallback((label: string, onConfirm: () => void) => {
    setPendingDelete({ label, onConfirm })
  }, [])

  const chatRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pullStartY = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const PULL_THRESHOLD = 80
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if ((chatRef.current?.scrollTop ?? 1) === 0) pullStartY.current = e.touches[0].clientY
  }, [])
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pullStartY.current) return
    const dist = e.touches[0].clientY - pullStartY.current
    if (dist > 0 && (chatRef.current?.scrollTop ?? 1) === 0) setPullDistance(Math.min(dist, 100))
    else { pullStartY.current = 0; setPullDistance(0) }
  }, [])
  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD) window.location.reload()
    pullStartY.current = 0
    setPullDistance(0)
  }, [pullDistance])
  const [isListening, setIsListening] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const ttsEnabledRef = useRef(false)
  ttsEnabledRef.current = ttsEnabled
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')
  const sendRef = useRef<(text: string) => void>(() => {})
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const convs = loadConversations()
    setConversations(convs)
    setQrHistory(loadHistory())
    initAuth().catch(() => {})
    setSuggestions(getRandomSuggestions())
    document.documentElement.dataset.theme = getTheme()
    if (convs.length > 0) {
      const latest = convs[0]
      setActiveConvId(latest.id)
      setMessages(latest.messages)
      setCurrentQr(latest.lastQr)
    }
  }, [])

  useEffect(() => { setCurrentDevice(getDefaultDevice()) }, [settingsVersion])
  useEffect(() => { if (messages.length > 0) setDeviceChangedHint(true) }, [currentDevice]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    })
  }, [])

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  // Persist conversation — reads from localStorage to avoid stale state
  const persistConversation = useCallback((id: string, msgs: ChatMessage[], lastQr: QrResult | null, titleOverride?: string) => {
    const existing = loadConversations().find(c => c.id === id)
    upsertConversation({
      id,
      title: titleOverride ?? existing?.title ?? autoTitle(msgs),
      messages: msgs,
      lastQr,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    setConversations(loadConversations())
  }, [])

  // New chat — just resets UI, conversation only persisted after first message
  const startNewChat = useCallback(() => {
    setActiveConvId(null)
    setMessages([])
    setCurrentQr(null)
    setSuggestions(getRandomSuggestions())
    setError(null)
    setInput('')
    setDeviceChangedHint(false)
    requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = 0
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    })
  }, [])

  const switchConversation = useCallback((id: string) => {
    const convs = loadConversations()
    const conv = convs.find(c => c.id === id)
    if (!conv) return
    setActiveConvId(id)
    setMessages(conv.messages)
    setCurrentQr(conv.lastQr)
    setError(null)
    setInput('')
  }, [])

  const handleDeleteConversation = useCallback((id: string) => {
    deleteConversation(id)
    const remaining = loadConversations()
    setConversations(remaining)
    if (id === activeConvId) {
      if (remaining.length > 0) {
        switchConversation(remaining[0].id)
      } else {
        setActiveConvId(null)
        setMessages([])
        setCurrentQr(null)
      }
    }
  }, [activeConvId, switchConversation])

  const handleDeleteHistoryItem = useCallback((id: string) => {
    deleteHistoryItem(id)
    setQrHistory(prev => prev.filter(i => i.id !== id))
    setSelectedHistoryItem(null)
  }, [])

  const handleEditMsg = useCallback((index: number) => {
    const msg = messages[index]
    setMessages(messages.slice(0, index))
    setInput(msg.content)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
        textareaRef.current.focus()
      }
    })
  }, [messages])

  const handleDeleteMsg = useCallback((index: number) => {
    setMessages(prev => prev.slice(0, index))
  }, [])

  const handleRenameHistoryItem = useCallback((id: string, newName: string) => {
    renameHistoryItem(id, newName)
    setQrHistory(prev => prev.map(i => i.id !== id ? i : { ...i, presetName: newName, qr: { ...i.qr, presetName: newName } }))
    setSelectedHistoryItem(prev => prev?.id !== id ? prev : { ...prev, presetName: newName, qr: { ...prev.qr, presetName: newName } })
  }, [])

  const handleRenameConversation = useCallback((id: string, newTitle: string) => {
    setConversations(prev => {
      const updated = prev.map(c => c.id !== id ? c : { ...c, title: newTitle, updatedAt: Date.now() })
      const conv = updated.find(c => c.id === id)
      if (conv) upsertConversation(conv)
      return updated
    })
  }, [])

  const openHistoryItemInChat = useCallback((item: HistoryItem) => {
    setSelectedHistoryItem(null)
    setSidebarOpen(false)
    const convId = uuidv4()
    setActiveConvId(convId)
    setCurrentQr(item.qr)
    setError(null)
    setInput('')
    const label = item.qr.importNote || item.qr.presetName
    const assistantMsg: ChatMessage = {
      id: uuidv4(), role: 'assistant',
      content: `Here's your "${label}" preset for ${item.qr.deviceName}. Let me know if you'd like to change anything.`,
      qr: item.qr,
    }
    const msgs = [assistantMsg]
    setMessages(msgs)
    persistConversation(convId, msgs, item.qr, item.presetName)
    setConversations(loadConversations())
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [persistConversation])

  const finishImport = useCallback((qr: QrResult) => {
    if (qr.deviceId && qr.deviceId !== currentDevice) {
      setDeviceMismatchPending({ qr })
    } else {
      const item = saveToHistory(qr)
      setQrHistory(prev => [item, ...prev.filter(h => h.qr.qrString !== qr.qrString)].slice(0, 20))

      // Populate the new chat with the imported QR
      const convId = uuidv4()
      setActiveConvId(convId)
      setCurrentQr(qr)
      setError(null)
      setInput('')
      const label = qr.importNote || qr.presetName
      const assistantMsg: ChatMessage = { id: uuidv4(), role: 'assistant', content: `Here's your "${label}" preset for ${qr.deviceName}. Let me know if you'd like to change anything.`, qr }
      const msgs = [assistantMsg]
      setMessages(msgs)
      persistConversation(convId, msgs, qr, qr.presetName)
      setConversations(loadConversations())
    }
  }, [currentDevice, persistConversation])

  const refineFromHistoryItem = useCallback((item: HistoryItem) => {
    const enabledSettings = item.qr.settings.filter(s => s.enabled)
    const settingsList = enabledSettings.map(s => {
      const paramStr = s.params && Object.keys(s.params).length
        ? ` (${Object.entries(s.params).map(([k, v]) => `${k}: ${v}`).join(', ')})`
        : ''
      return `• ${s.slot}: ${s.selection}${paramStr}`
    }).join('\n')
    const isImported = !!item.qr.imported
    const songRef = item.qr.importNote ? ` — song reference: ${item.qr.importNote}` : ''
    const importContext = isImported
      ? `\n\nThis preset was imported from an external source${songRef}. Please interpret the settings to understand the musical character and intent before making any changes. When refining, preserve the core character unless the user asks to change it.`
      : ''
    const convId = uuidv4()
    setActiveConvId(convId)
    setCurrentQr(item.qr)
    setError(null)
    setInput('')
    const userMsg: ChatMessage = {
      id: uuidv4(), role: 'user',
      content: `I want to refine an existing preset called "${item.qr.presetName}" on my ${item.qr.deviceName}.\n\nCurrent settings:\n${settingsList}${importContext}`,
    }
    const displayRef = item.qr.importNote || item.qr.presetName
    const assistantMsg: ChatMessage = {
      id: uuidv4(), role: 'assistant',
      content: isImported
        ? `I've analysed your imported "${displayRef}" preset. I can see the amp, cabinet, and effects settings — what would you like to change or improve?`
        : `I can see your "${item.qr.presetName}" preset. What would you like to change about this tone?`,
      qr: item.qr,
    }
    const msgs = [userMsg, assistantMsg]
    setMessages(msgs)
    persistConversation(convId, msgs, item.qr)
    setConversations(loadConversations())
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [persistConversation])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()

    // Assign a conversation ID — create new if needed, but don't persist yet
    let convId = activeConvId
    if (!convId) {
      convId = uuidv4()
      setActiveConvId(convId)
    }

    const userMsg: ChatMessage = { id: uuidv4(), role: 'user', content: trimmed }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setError(null)
    setDeviceChangedHint(false)

    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    scrollToBottom()

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await sendChat(newMessages.map(({ role, content }) => ({ role, content })), abort.signal, currentDevice)
      setQuotaVersion(v => v + 1)
      const aiMsg: ChatMessage = { id: uuidv4(), role: 'assistant', content: res.message, qr: res.qr, sources: res.sources }
      if (ttsEnabledRef.current && typeof window !== 'undefined' && window.speechSynthesis) {
        const plain = res.message.replace(/#{1,6} /g, '').replace(/[*_`~>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n+/g, ' ').trim()
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(plain))
      }
      const finalMessages = [...newMessages, aiMsg]
      let newQr = currentQr
      if (res.qr) newQr = res.qr

      flushSync(() => {
        setMessages(finalMessages)
        if (res.qr) setCurrentQr(res.qr)
      })

      if (res.qr) {
        const item = saveToHistory(res.qr)
        setQrHistory(prev => [item, ...prev.filter(h => h.qr.qrString !== res.qr!.qrString)].slice(0, 20))
      }

      persistConversation(convId!, finalMessages, newQr)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') { setMessages(messages) } // roll back the unanswered user message
      else flushSync(() => setError(friendlyError(e)))
    } finally {
      abortRef.current = null
      flushSync(() => setLoading(false))
      scrollToBottom()
    }
  }, [loading, messages, activeConvId, currentQr, currentDevice, scrollToBottom, persistConversation])

  sendRef.current = send

  // Force re-render when returning from background — browsers throttle React renders in hidden tabs
  const [, setVisibilityTick] = useState(0)
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') setVisibilityTick(t => t + 1) }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    window.speechSynthesis?.cancel()
    const r = new SR()
    r.continuous = false
    r.interimResults = true
    r.lang = 'en-US'
    r.onstart = () => setIsListening(true)
    r.onresult = (e: any) => {
      const t = Array.from(e.results as any[]).map((res: any) => res[0].transcript).join('')
      finalTranscriptRef.current = t
      setInput(t)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }
      })
    }
    r.onend = () => {
      setIsListening(false)
      const text = finalTranscriptRef.current.trim()
      finalTranscriptRef.current = ''
      if (text) setTimeout(() => sendRef.current(text), 50)
    }
    r.onerror = () => setIsListening(false)
    recognitionRef.current = r
    r.start()
  }, [isListening])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    resizeTextarea()
  }

  return (
    <div className="flex h-full bg-bg">

      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={switchConversation}
        onNew={startNewChat}
        onDelete={handleDeleteConversation}
        onRenameConv={handleRenameConversation}
        qrHistory={qrHistory}
        onQrSelect={item => { setSelectedHistoryItem(item) }}
        onQrDelete={id => handleDeleteHistoryItem(id)}
        onRenameQr={handleRenameHistoryItem}
        onDeleteRequest={requestDelete}
        visible={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onCollapse={() => setSidebarCollapsed(true)}
        onQrImported={async (file) => {
          try {
          startNewChat()
          const scanned = await scanQrFromFile(file)
          if (!scanned) { setError("Couldn't find a QR code in this image."); return }
          const decoded = await decodeQr(scanned.qrString)
          if (!decoded) { setError("QR code found but couldn't be decoded — it may not be a NUX preset."); return }
          let ocrText = ''
          if (typeof window !== 'undefined' && 'TextDetector' in window) {
            const bitmap = await createImageBitmap(file)
            ocrText = await ocrImageText(bitmap)
          }
          const filenameHint = file.name.replace(/\.[^.]+$/, '').replace(/[_\-\.]+/g, ' ').trim()
          const IGNORED_FILENAMES = ['download', 'qr', 'image', 'photo', 'file', 'scan']
          const importNote = ocrText || (
            filenameHint && !IGNORED_FILENAMES.includes(filenameHint.toLowerCase()) ? filenameHint : ''
          )
          const qr: QrResult = {
            qrString: scanned.qrString,
            imageBase64: scanned.imageBase64,
            presetName: decoded.presetName === 'Imported Preset' && importNote ? importNote : decoded.presetName,
            deviceName: decoded.deviceName,
            deviceId: decoded.deviceId,
            settings: decoded.settings,
            importNote: importNote || undefined,
            imported: true,
          }
          setSidebarOpen(false)
          if (importNote) {
            const guess = await identifyQr(importNote)
            if (guess.artist && guess.song) {
              setPendingImport({ qr, guess: { artist: guess.artist, song: guess.song } })
              return
            }
          }
          finishImport(qr)
          } catch (err) { setError(friendlyError(err)) }
        }}
        onSettings={() => setShowSettings(true)}
        onDeleteAllChats={() => requestDelete('all conversations', () => {
          clearAllConversations()
          setConversations([])
          setActiveConvId(null)
          setMessages([])
          setCurrentQr(null)
        })}
        onDeleteAllQr={() => requestDelete('all QR codes', () => {
          clearAllHistory()
          setQrHistory([])
          setSelectedHistoryItem(null)
        })}
      />

      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Header */}
        <header className="bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.25)]">

          {/* ── Desktop: single flex row ── */}
          <div className="hidden md:flex md:items-center px-4 py-2.5 gap-3">
            <button onClick={() => { sidebarCollapsed ? setSidebarCollapsed(false) : (window.innerWidth >= 1024 ? setSidebarCollapsed(true) : setSidebarOpen(true)) }} className="text-fg-3 hover:text-fg transition-colors"><MenuIcon /></button>
            <button onClick={startNewChat} className="text-sm font-semibold text-fg hover:text-fg-2 transition-colors">Mighty AI QR</button>
            <div className="ml-auto flex items-center gap-2">
              <QuotaPill quotaVersion={quotaVersion} />
              {activeConvId && (
                <button onClick={() => { handleDeleteConversation(activeConvId); startNewChat() }} title="Delete conversation" className="flex items-center justify-center h-8 w-8 text-fg-3 hover:text-red-400 transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              )}
              <button onClick={startNewChat} title="New chat" className="flex items-center justify-center h-8 w-8 text-fg-3 hover:text-fg transition-colors"><NewChatIcon /></button>
              <button onClick={() => setShowSettings(true)} title="Settings" className="flex items-center justify-center h-8 w-8 rounded-lg text-fg-3 hover:text-fg transition-colors"><GearIcon /></button>
            </div>
          </div>

          {/* ── Mobile: single row ── */}
          <div className="md:hidden flex items-center px-4 py-2.5 gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-fg-3 hover:text-fg transition-colors"><MenuIcon /></button>
            <button onClick={startNewChat} className="text-sm font-semibold text-fg hover:text-fg-2 transition-colors">Mighty AI QR</button>
            <div className="ml-auto flex items-center gap-2">
              <QuotaPill quotaVersion={quotaVersion} />
              {activeConvId && (
                <button onClick={() => { handleDeleteConversation(activeConvId); startNewChat() }} title="Delete conversation" className="flex items-center justify-center h-9 w-9 text-fg-3 hover:text-red-400 transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              )}
              <button onClick={startNewChat} title="New chat" className="flex items-center justify-center h-9 w-9 text-fg-3 hover:text-fg transition-colors"><NewChatIcon /></button>
              <button onClick={() => setShowSettings(true)} title="Settings" className="flex items-center justify-center h-8 w-8 rounded-lg text-fg-3 hover:text-fg transition-colors"><GearIcon /></button>
            </div>
          </div>

        </header>

        {/* Chat + QR */}
        <div className="flex flex-1 overflow-hidden">

          {/* Chat */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-6" onClick={() => setActiveMessageId(null)} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
              {pullDistance > 10 && (
                <div className="flex justify-center pb-2 text-xs text-fg-4 transition-opacity select-none">
                  {pullDistance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
                </div>
              )}
              <div className="mx-auto w-full max-w-2xl space-y-4">
              {!hintDismissed && (
                <ByokHintBanner
                  onDismiss={() => { saveHintDismissed(true); setHintDismissed(true) }}
                  onOpenSettings={() => setShowSettings(true)}
                />
              )}
              {messages.length === 0 && input.trim() ? (
                <div className="flex h-full flex-col items-center justify-center animate-fade-in">
                  <p className="text-sm text-fg-4">Edit your message below and send to continue from here.</p>
                </div>
              ) : messages.length === 0 ? (
                <SuggestionScreen onSend={send} />
              ) : (
                messages.map((msg, idx) => (
                  <MessageRow
                    key={msg.id}
                    msg={msg}
                    idx={idx}
                    active={activeMessageId === msg.id}
                    onActivate={() => setActiveMessageId(msg.id)}
                    onDismiss={() => setActiveMessageId(null)}
                    onEdit={handleEditMsg}
                    onDelete={handleDeleteMsg}
                    onQrOpen={(qr, description) => setPopupQr({ qr, description })}
                    disabled={loading}
                  />
                ))
              )}
              {loading && (
                <div className="flex justify-start animate-slide-in-bottom">
                  <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2].map(i => <div key={i} className="typing-dot h-2 w-2 rounded-full bg-fg-3" />)}
                      <span className="ml-2 text-xs text-fg-3">Thinking…</span>
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>

            {error && (
              <div className="relative mx-4 mb-2 rounded-xl border px-4 py-2.5 pr-8" style={{ background: 'var(--error-bg)', borderColor: 'var(--error-border)' }}>
                <button onClick={() => setError(null)} className="absolute top-2.5 right-2.5 hover:text-fg-2" style={{ color: 'var(--error-fg)' }}><CloseIcon /></button>
                <span className="text-sm" style={{ color: 'var(--error-fg)' }}>{error}</span>
                {getErrorExplanation(error) && (
                  <button
                    onClick={() => setShowErrorExplain(true)}
                    className="mt-1 block text-[11px] underline underline-offset-2 opacity-70 hover:opacity-100"
                    style={{ color: 'var(--error-fg)' }}
                  >
                    What does this mean?
                  </button>
                )}
              </div>
            )}

            <div className="border-t border-white/10 bg-surface px-4 pb-5 pt-3">
              <div className="rounded-3xl border border-white/10 bg-surface-2 transition-colors focus-within:border-primary/40">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  placeholder="Describe your tone…"
                  rows={1}
                  className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-fg placeholder-fg-4 outline-none disabled:opacity-50"
                  style={{ maxHeight: '120px', overflowY: 'auto' }}
                />
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTtsEnabled(v => { if (v) window.speechSynthesis?.cancel(); return !v })}
                      title={ttsEnabled ? 'TTS on — click to disable' : 'TTS off — click to enable'}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${ttsEnabled ? 'text-primary hover:opacity-80' : 'text-fg-4 hover:text-fg-3'}`}
                    >
                      {ttsEnabled ? <VolumeIcon /> : <VolumeOffIcon />}
                    </button>
                    <button
                      onClick={() => setShowSettings(true)}
                      title="Change device in Settings"
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-surface-2 px-2.5 py-1.5 text-xs text-fg-3 hover:bg-surface-3 hover:text-fg transition-colors"
                    >
                      {NUX_DEVICES.find(d => d.id === currentDevice)?.label ?? currentDevice}
                    </button>
                    {deviceChangedHint && <span className="text-[10px] text-primary animate-pulse">Device changed — ask for a new tone</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={toggleListening}
                      title={isListening ? 'Stop recording' : 'Voice input'}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl transition-colors ${isListening ? 'text-red-400 bg-red-500/10 animate-pulse' : 'text-fg-4 hover:text-fg-3'}`}
                    >
                      <MicIcon />
                    </button>
                    {loading ? (
                      <button
                        onClick={() => { abortRef.current?.abort(); setLoading(false) }}
                        title="Cancel"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary hover:opacity-90 transition-colors"
                      >
                        <StopIcon />
                      </button>
                    ) : (
                      <button
                        onClick={() => send(input)}
                        disabled={!input.trim()}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <SendIcon />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>


        </div>
      </div>

      {deviceMismatchPending && (
        <DeviceMismatchModal
          qr={deviceMismatchPending.qr}
          targetDevice={currentDevice}
          converting={deviceMismatchConverting}
          onClose={() => setDeviceMismatchPending(null)}
          onConvert={async () => {
            setDeviceMismatchConverting(true)
            try {
              const converted = await convertPreset(deviceMismatchPending.qr.qrString, currentDevice, deviceMismatchPending.qr.presetName)
              const qToSave = converted ? { ...deviceMismatchPending.qr, qrString: converted.qrString, imageBase64: converted.imageBase64, deviceName: converted.deviceName, settings: converted.settings } : deviceMismatchPending.qr
              const item = saveToHistory(qToSave)
              setQrHistory(prev => [item, ...prev.filter(h => h.qr.qrString !== qToSave.qrString)].slice(0, 20))
        
              openHistoryItemInChat(item)
            } catch { setError('Conversion failed — saving original.') } finally {
              setDeviceMismatchConverting(false)
              setDeviceMismatchPending(null)
            }
          }}
          onSaveOriginal={() => {
            const item = saveToHistory(deviceMismatchPending.qr)
            setQrHistory(prev => [item, ...prev.filter(h => h.qr.qrString !== deviceMismatchPending.qr.qrString)].slice(0, 20))
      
            openHistoryItemInChat(item)
            setDeviceMismatchPending(null)
          }}
        />
      )}


      {popupQr && (
        <ChatQrModal
          qr={popupQr.qr}
          description={popupQr.description}
          currentDevice={currentDevice}
          onClose={() => { setPopupQr(null); requestAnimationFrame(() => { scrollToBottom(); textareaRef.current?.focus() }) }}
          onConvert={converted => {
            const newItem = saveToHistory(converted)
            setQrHistory(prev => [newItem, ...prev.filter(h => h.qr.qrString !== converted.qrString)].slice(0, 20))
            const newMsg: ChatMessage = { id: uuidv4(), role: 'assistant', content: `Converted to ${converted.deviceName}.`, qr: converted }
            setMessages(prev => [...prev, newMsg])
            setPopupQr({ qr: converted, description: '' })
            setCurrentQr(converted)
          }}
        />
      )}

      {showSettings && <SettingsPanel onClose={() => { setShowSettings(false); setSettingsVersion(v => v + 1) }} hintDismissed={hintDismissed} onHintDismissedChange={v => { setHintDismissed(v) }} />}
      {showWelcome && <WelcomeModal onDismiss={() => { saveWelcomeSeen(pkg.version); setShowWelcome(false) }} />}

      {showErrorExplain && error && (
        <ErrorExplainModal error={error} onClose={() => setShowErrorExplain(false)} />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          label={pendingDelete.label}
          onConfirm={() => { pendingDelete.onConfirm(); setPendingDelete(null) }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {selectedHistoryItem && (
        <QrModal
          item={selectedHistoryItem}
          currentDevice={currentDevice}
          onClose={() => setSelectedHistoryItem(null)}
          onConvert={converted => {
            const newItem = saveToHistory(converted)
            setQrHistory(prev => [newItem, ...prev.filter(h => h.qr.qrString !== converted.qrString)].slice(0, 20))
            setSelectedHistoryItem(newItem)
          }}
          onDeleteRequest={() => requestDelete(selectedHistoryItem.presetName, () => handleDeleteHistoryItem(selectedHistoryItem.id))}
          onRename={name => handleRenameHistoryItem(selectedHistoryItem.id, name)}
          onOpen={() => openHistoryItemInChat(selectedHistoryItem)}
          autoRename={isGenericName(selectedHistoryItem.presetName)}
        />
      )}

      {importNamePending && (
        <ImportNameModal
          qr={importNamePending.qr}
          suggestedName={importNamePending.suggestedName}
          onCancel={() => setImportNamePending(null)}
          onSave={name => {
            const qr = { ...importNamePending.qr, presetName: name, importNote: name }
            setImportNamePending(null)
            finishImport(qr)
          }}
        />
      )}

      {pendingImport && (
        <IdentifyConfirmModal
          artist={pendingImport.guess.artist}
          song={pendingImport.guess.song}
          onConfirm={() => {
            const updatedQr = { ...pendingImport.qr, presetName: `${pendingImport.guess.artist} — ${pendingImport.guess.song}`, importNote: `${pendingImport.guess.artist} — ${pendingImport.guess.song}` }
            setPendingImport(null)
            finishImport(updatedQr)
          }}
          onDismiss={() => {
            const qr = pendingImport.qr
            setPendingImport(null)
            setImportNamePending({ qr, suggestedName: `${pendingImport.guess.artist} — ${pendingImport.guess.song}` })
          }}
        />
      )}
    </div>
  )
}
