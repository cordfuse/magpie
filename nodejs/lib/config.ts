// Branding + custom theme config. RUNTIME-loaded from magpie.config.json so
// dropping a new file on a hosted instance takes effect on the next request
// — no rebuild required. Server-only (uses fs); client code receives values
// via SSR (server components pass as props, or layout.tsx injects them into
// the rendered HTML).
//
// File lookup precedence:
//   1. $MAGPIE_CONFIG_PATH if set (explicit file)
//   2. $MAGPIE_CONFIG_DIR/magpie.config.json if set (operator-mounted volume)
//   3. <cwd>/config/magpie.config.json (default convention; the standalone
//      server chdirs to .next/standalone/, so we also probe its ancestors)
//   4. <cwd>/magpie.config.json (legacy path, kept for ad-hoc setups)

import fs from 'node:fs'
import path from 'node:path'
import { BUILT_IN_LOCALES } from './i18n'

// Single source of truth for the customization directory. Used by the
// config loader, the MCP loader, and the icon-serving route. Set
// MAGPIE_CONFIG_DIR to mount a different volume; default `./config` keeps
// dev simple — the repo ships a populated config/ dir.
export function getConfigDir(): string {
  if (process.env.MAGPIE_CONFIG_DIR) return process.env.MAGPIE_CONFIG_DIR
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

export interface MagpieConfig {
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

const defaults: MagpieConfig = {
  name: 'Magpie',
  shortName: 'Magpie',
  tagline: 'Embeddable AI chatbot framework',
  defaultSystemPrompt: 'You are a helpful AI assistant.',
  welcomeMessage: '',
  starterPrompts: [],
  checkForUpdatesUrl: 'https://github.com/cordfuse/magpie/releases',
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
  const explicit = process.env.MAGPIE_CONFIG_PATH
  if (explicit) {
    try { if (fs.statSync(explicit).isFile()) return explicit } catch { /* fall through */ }
    return null
  }
  const dir = getConfigDir()
  const candidates = [
    path.join(dir, 'magpie.config.json'),
    // Standalone server chdirs to .next/standalone/ — when MAGPIE_CONFIG_DIR
    // resolves to a relative ./config that doesn't exist there, walk up.
    path.join(process.cwd(), '..', 'config', 'magpie.config.json'),
    path.join(process.cwd(), '..', '..', 'config', 'magpie.config.json'),
    // Legacy ad-hoc paths (file directly in CWD or a parent).
    path.join(process.cwd(), 'magpie.config.json'),
    path.join(process.cwd(), '..', 'magpie.config.json'),
    path.join(process.cwd(), '..', '..', 'magpie.config.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p
    } catch { /* try next */ }
  }
  return null
}

export interface KioskFlags {
  showHeader: boolean
  showHeaderIcon: boolean
  showHeaderTitle: boolean
  showSettings: boolean
  persistChat: boolean
  showWebSearch: boolean
  showMcp: boolean
  showModelPicker: boolean
  showAttachments: boolean
  showVoiceInput: boolean
  showVoiceOutput: boolean
}

interface LoadedConfig {
  config: MagpieConfig
  themeCss: string
  // Raw CSS read from <configDir>/custom.css (if the file exists). Injected
  // into <head> after themeCss so it can override any built-in token. Sourced
  // from a real CSS file so operators get proper editor support — no JSON
  // string escaping. Drop the file and refresh; no rebuild.
  customCss: string
  allowedThemeIds: string[]
  defaultTheme: string
  themeColor: string
  flags: KioskFlags
  // i18n: all locale maps merged together (built-ins + any operator JSON
  // dropped in <configDir>/locales/*.json). Sent to the client wholesale
  // so t() lookups are sync. List of locale codes ordered alphabetically
  // with English first for picker display.
  locales: Record<string, Record<string, string>>
  localeCodes: string[]
  // Server-default locale: env MAGPIE_LOCALE if set and valid, else 'en'.
  // The actual rendered locale per-request is resolved from the cookie
  // (see resolveLocale in lib/i18n/server.ts) using this as fallback.
  defaultLocale: string
}

// Kiosk visibility flags. All default ON (full UI). Setting any to '0' or
// 'false' hides the corresponding control. A hidden control means the feature
// runs server-side with whatever's configured (web search uses TAVILY if set;
// MCP uses every server in magpie-mcp.json; model picker uses MAGPIE_PROVIDER +
// MAGPIE_MODEL). To disable a feature entirely, don't configure it.
function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v === '') return defaultValue
  if (v === '0' || v.toLowerCase() === 'false') return false
  if (v === '1' || v.toLowerCase() === 'true') return true
  return defaultValue
}

export function loadKioskFlags(): KioskFlags {
  return {
    showHeader:      envBool('MAGPIE_SHOW_HEADER',       true),
    showHeaderIcon:  envBool('MAGPIE_SHOW_HEADER_ICON',  true),
    showHeaderTitle: envBool('MAGPIE_SHOW_HEADER_TITLE', true),
    showSettings:    envBool('MAGPIE_SHOW_SETTINGS',     true),
    persistChat:     envBool('MAGPIE_PERSIST_CHAT',      true),
    showWebSearch:   envBool('MAGPIE_SHOW_WEB_SEARCH',   true),
    showMcp:         envBool('MAGPIE_SHOW_MCP',          true),
    showModelPicker: envBool('MAGPIE_SHOW_MODEL_PICKER', true),
    showAttachments: envBool('MAGPIE_SHOW_ATTACHMENTS',  true),
    showVoiceInput:  envBool('MAGPIE_SHOW_VOICE_INPUT',  true),
    showVoiceOutput: envBool('MAGPIE_SHOW_VOICE_OUTPUT', true),
  }
}

// Reads the file fresh each call. JSON is tiny (~1KB) and Node caches the
// directory lookup; the read itself is microseconds. No memoization here is
// intentional — we want drop-file-and-refresh behavior.
export function loadMagpieConfig(): LoadedConfig {
  const file = locateConfigFile()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any = {}
  if (file) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { /* fall through to defaults */ }
  }

  const config: MagpieConfig = {
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

  // Optional operator stylesheet. Lives next to magpie.config.json in the
  // mounted config volume so it can be edited with full editor support
  // (syntax highlighting, etc.) rather than as an escaped JSON string.
  // Missing file is normal — most deployments don't need it.
  let customCss = ''
  try {
    customCss = fs.readFileSync(path.join(getConfigDir(), 'custom.css'), 'utf-8')
  } catch { /* file absent — no custom CSS for this deployment */ }

  // i18n: merge built-in locales with any operator-supplied JSON files in
  // <configDir>/locales/. Operator JSON may override a built-in key or add
  // an entirely new locale. Same drop-file-and-refresh ergonomics as
  // custom.css and magpie-mcp.json.
  const locales: Record<string, Record<string, string>> = {}
  for (const [code, map] of Object.entries(BUILT_IN_LOCALES)) locales[code] = { ...map }
  const localesDir = path.join(getConfigDir(), 'locales')
  try {
    for (const f of fs.readdirSync(localesDir)) {
      if (!f.endsWith('.json')) continue
      const code = f.replace(/\.json$/, '')
      try {
        const raw = fs.readFileSync(path.join(localesDir, f), 'utf-8')
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // String-valued entries only — silently skip anything else.
          const sanitized: Record<string, string> = {}
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string') sanitized[k] = v
          }
          locales[code] = { ...(locales[code] ?? {}), ...sanitized }
        }
      } catch { /* malformed JSON — skip this file, keep going */ }
    }
  } catch { /* locales dir absent — built-ins only */ }
  const localeCodes = Object.keys(locales).sort((a, b) =>
    a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)
  )
  const envLocale = (process.env.MAGPIE_LOCALE ?? '').trim()
  const defaultLocale = envLocale && locales[envLocale] ? envLocale : 'en'

  return {
    config, themeCss, customCss,
    allowedThemeIds, defaultTheme, themeColor,
    flags: loadKioskFlags(),
    locales, localeCodes, defaultLocale,
  }
}

// Built-in theme IDs — re-exported so client-side code can use them as a
// fallback (when SSR-injected allowed list isn't available, e.g. during
// initial render bootstrap).
export const BUILT_IN_THEMES = BUILT_IN_THEME_IDS
