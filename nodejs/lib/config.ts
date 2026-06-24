// Branding + custom theme config. RUNTIME-loaded from quill.config.json so
// dropping a new file on a hosted instance takes effect on the next request
// — no rebuild required. Server-only (uses fs); client code receives values
// via SSR (server components pass as props, or layout.tsx injects them into
// the rendered HTML).
//
// The file is searched at:
//   1. $QUILL_CONFIG_PATH if set
//   2. CWD/quill.config.json (works for `next dev` from nodejs/ and for the
//      standalone server which chdirs to .next/standalone/ — we also probe
//      one and two levels up for the standalone case)

import fs from 'node:fs'
import path from 'node:path'

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
  checkForUpdatesUrl: string
  defaultTheme: string
  hideBuiltInThemes: boolean
  themes: CustomTheme[]
}

const defaults: QuillConfig = {
  name: 'Quill',
  shortName: 'Quill',
  tagline: 'Agent-agnostic AI chatbot framework',
  defaultSystemPrompt: 'You are a helpful AI assistant.',
  checkForUpdatesUrl: 'https://github.com/cordfuse/quill/releases',
  defaultTheme: 'dracula',
  hideBuiltInThemes: false,
  themes: [],
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
  const candidates = explicit
    ? [explicit]
    : [
        path.join(process.cwd(), 'quill.config.json'),
        path.join(process.cwd(), '..', 'quill.config.json'),
        path.join(process.cwd(), '..', '..', 'quill.config.json'),
        path.join(process.cwd(), '..', '..', '..', 'quill.config.json'),
      ]
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p
    } catch { /* try next */ }
  }
  return null
}

interface LoadedConfig {
  config: QuillConfig
  themeCss: string
  allowedThemeIds: string[]
  defaultTheme: string
  themeColor: string
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
    checkForUpdatesUrl: typeof raw.checkForUpdatesUrl === 'string' ? raw.checkForUpdatesUrl : defaults.checkForUpdatesUrl,
    defaultTheme: typeof raw.defaultTheme === 'string' ? raw.defaultTheme : defaults.defaultTheme,
    hideBuiltInThemes: raw.hideBuiltInThemes === true,
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

  return { config, themeCss, allowedThemeIds, defaultTheme, themeColor }
}

// Built-in theme IDs — re-exported so client-side code can use them as a
// fallback (when SSR-injected allowed list isn't available, e.g. during
// initial render bootstrap).
export const BUILT_IN_THEMES = BUILT_IN_THEME_IDS
