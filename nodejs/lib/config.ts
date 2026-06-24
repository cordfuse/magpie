// Branding + custom theme config. RUNTIME-loaded from quill.config.json so
// dropping a new file on a hosted instance takes effect on the next request
// — no rebuild required. Server-only (uses fs); client code receives values
// via SSR (server components pass as props, or layout.tsx injects them into
// the rendered HTML).
//
// File lookup precedence:
//   1. $QUILL_CONFIG_PATH if set (explicit file)
//   2. $QUILL_CONFIG_DIR/quill.config.json if set (operator-mounted volume)
//   3. <cwd>/config/quill.config.json (default convention; the standalone
//      server chdirs to .next/standalone/, so we also probe its ancestors)
//   4. <cwd>/quill.config.json (legacy path, kept for ad-hoc setups)

import fs from 'node:fs'
import path from 'node:path'

// Single source of truth for the customization directory. Used by the
// config loader, the MCP loader, and the icon-serving route. Set
// QUILL_CONFIG_DIR to mount a different volume; default `./config` keeps
// dev simple — the repo ships a populated config/ dir.
export function getConfigDir(): string {
  if (process.env.QUILL_CONFIG_DIR) return process.env.QUILL_CONFIG_DIR
  return path.join(process.cwd(), 'config')
}

const CSS_VAR_KEYS = [
  'bg', 'surface', 'surface-2', 'surface-3',
  'primary', 'on-primary',
  'fg', 'fg-2', 'fg-3', 'fg-4',
  'scrollbar', 'scrollbar-h',
  'error-bg', 'error-border', 'error-fg',
] as const

export type ThemeColorKey = (typeof CSS_VAR_KEYS)[number]

export interface CustomTheme {
  id: string
  name: string
  category: 'dark' | 'light'
  swatches?: [string, string, string]
  colors: Partial<Record<ThemeColorKey, string>>
}

export interface QuillConfig {
  name: string
  shortName: string
  tagline: string
  defaultSystemPrompt: string
  welcomeMessage: string
  // Clickable prompt chips shown below the welcome bubble (or in place of
  // the "Start a conversation." placeholder when no welcome is set). Each
  // chip's text becomes the user's first message on click. Especially
  // useful in kiosk mode — turns an empty chat into a guided menu.
  starterPrompts: string[]
  checkForUpdatesUrl: string
  defaultTheme: string
  hideBuiltInThemes: boolean
  themes: CustomTheme[]
  // Icon paths (web-relative, served from public/). Used for the browser
  // favicon AND the PWA manifest. icon192 drives both; icon512 is PWA only.
  // Default points at the bundled feather. Forkers drop their PNGs in
  // public/ (any subdir works) and update these paths.
  icon192: string
  icon512: string
}

const defaults: QuillConfig = {
  name: 'Quill',
  shortName: 'Quill',
  tagline: 'Embeddable AI chatbot framework',
  defaultSystemPrompt: 'You are a helpful AI assistant.',
  welcomeMessage: '',
  starterPrompts: [],
  checkForUpdatesUrl: 'https://github.com/cordfuse/quill/releases',
  defaultTheme: 'dracula',
  hideBuiltInThemes: false,
  themes: [],
  icon192: '/branding/icon-192.png',
  icon512: '/branding/icon-512.png',
}

const BUILT_IN_THEME_IDS = [
  // dark
  'oled', 'dracula', 'one-dark', 'tokyo-night', 'nord', 'solarized-dark',
  'gruvbox-dark', 'monokai', 'catppuccin-mocha', 'night-owl',
  'synthwave', 'github-dark', 'palenight',
  // light
  'solarized-light', 'github-light', 'catppuccin-latte',
  'one-light', 'tokyo-night-light', 'ayu-light', 'gruvbox-light',
  'quiet-light', 'light-plus', 'material-lighter', 'nord-light', 'min-light',
]

const BUILT_IN_BG_FALLBACK = '#282a36'  // Dracula bg, matches :root in globals.css

function locateConfigFile(): string | null {
  const explicit = process.env.QUILL_CONFIG_PATH
  if (explicit) {
    try { if (fs.statSync(explicit).isFile()) return explicit } catch { /* fall through */ }
    return null
  }
  const dir = getConfigDir()
  const candidates = [
    path.join(dir, 'quill.config.json'),
    // Standalone server chdirs to .next/standalone/ — when QUILL_CONFIG_DIR
    // resolves to a relative ./config that doesn't exist there, walk up.
    path.join(process.cwd(), '..', 'config', 'quill.config.json'),
    path.join(process.cwd(), '..', '..', 'config', 'quill.config.json'),
    // Legacy ad-hoc paths (file directly in CWD or a parent).
    path.join(process.cwd(), 'quill.config.json'),
    path.join(process.cwd(), '..', 'quill.config.json'),
    path.join(process.cwd(), '..', '..', 'quill.config.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p
    } catch { /* try next */ }
  }
  return null
}

export interface KioskFlags {
  showSettings: boolean
  persistChat: boolean
  showWebSearch: boolean
  showMcp: boolean
  showModelPicker: boolean
  showAttachments: boolean
}

interface LoadedConfig {
  config: QuillConfig
  themeCss: string
  allowedThemeIds: string[]
  defaultTheme: string
  themeColor: string
  flags: KioskFlags
}

// Kiosk visibility flags. All default ON (full UI). Setting any to '0' or
// 'false' hides the corresponding control. A hidden control means the feature
// runs server-side with whatever's configured (web search uses TAVILY if set;
// MCP uses every server in quill-mcp.json; model picker uses QUILL_PROVIDER +
// QUILL_MODEL). To disable a feature entirely, don't configure it.
function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v === '') return defaultValue
  if (v === '0' || v.toLowerCase() === 'false') return false
  if (v === '1' || v.toLowerCase() === 'true') return true
  return defaultValue
}

export function loadKioskFlags(): KioskFlags {
  return {
    showSettings:    envBool('QUILL_SHOW_SETTINGS',     true),
    persistChat:     envBool('QUILL_PERSIST_CHAT',      true),
    showWebSearch:   envBool('QUILL_SHOW_WEB_SEARCH',   true),
    showMcp:         envBool('QUILL_SHOW_MCP',          true),
    showModelPicker: envBool('QUILL_SHOW_MODEL_PICKER', true),
    showAttachments: envBool('QUILL_SHOW_ATTACHMENTS',  true),
  }
}

// Reads the file fresh each call. JSON is tiny (~1KB) and Node caches the
// directory lookup; the read itself is microseconds. No memoization here is
// intentional — we want drop-file-and-refresh behavior.
export function loadQuillConfig(): LoadedConfig {
  const file = locateConfigFile()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any = {}
  if (file) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { /* fall through to defaults */ }
  }

  const config: QuillConfig = {
    name: typeof raw.name === 'string' ? raw.name : defaults.name,
    shortName: typeof raw.shortName === 'string' ? raw.shortName : defaults.shortName,
    tagline: typeof raw.tagline === 'string' ? raw.tagline : defaults.tagline,
    defaultSystemPrompt: typeof raw.defaultSystemPrompt === 'string' ? raw.defaultSystemPrompt : defaults.defaultSystemPrompt,
    welcomeMessage: typeof raw.welcomeMessage === 'string' ? raw.welcomeMessage : defaults.welcomeMessage,
    starterPrompts: Array.isArray(raw.starterPrompts)
      ? raw.starterPrompts.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0)
      : defaults.starterPrompts,
    checkForUpdatesUrl: typeof raw.checkForUpdatesUrl === 'string' ? raw.checkForUpdatesUrl : defaults.checkForUpdatesUrl,
    defaultTheme: typeof raw.defaultTheme === 'string' ? raw.defaultTheme : defaults.defaultTheme,
    hideBuiltInThemes: raw.hideBuiltInThemes === true,
    icon192: typeof raw.icon192 === 'string' ? raw.icon192 : defaults.icon192,
    icon512: typeof raw.icon512 === 'string' ? raw.icon512 : defaults.icon512,
    themes: Array.isArray(raw.themes) ? raw.themes.filter((t: unknown): t is CustomTheme => {
      return !!t && typeof t === 'object'
        && typeof (t as CustomTheme).id === 'string'
        && typeof (t as CustomTheme).name === 'string'
        && (t as CustomTheme).colors !== undefined
    }) : defaults.themes,
  }

  const themeCss = config.themes
    .map(t => {
      const vars = Object.entries(t.colors)
        .filter(([k]) => (CSS_VAR_KEYS as readonly string[]).includes(k))
        .map(([k, v]) => `  --${k}: ${v};`)
        .join('\n')
      return `[data-theme="${t.id}"] {\n${vars}\n}`
    })
    .join('\n')

  const allowedThemeIds: string[] = [
    ...(config.hideBuiltInThemes ? [] : BUILT_IN_THEME_IDS),
    ...config.themes.map(t => t.id),
  ]

  const defaultTheme: string =
    allowedThemeIds.includes(config.defaultTheme) ? config.defaultTheme :
    allowedThemeIds.includes('dracula') ? 'dracula' :
    (allowedThemeIds[0] ?? 'dracula')

  const themeColor = config.themes.find(t => t.id === defaultTheme)?.colors.bg ?? BUILT_IN_BG_FALLBACK

  return { config, themeCss, allowedThemeIds, defaultTheme, themeColor, flags: loadKioskFlags() }
}

// Built-in theme IDs — re-exported so client-side code can use them as a
// fallback (when SSR-injected allowed list isn't available, e.g. during
// initial render bootstrap).
export const BUILT_IN_THEMES = BUILT_IN_THEME_IDS
