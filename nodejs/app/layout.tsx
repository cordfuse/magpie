import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { loadMagpieConfig } from '@/lib/config'
import { resolveLocale } from '@/lib/i18n/server'
import { I18nProvider } from '@/lib/i18n/client'
import './globals.css'

// Re-render the layout per request so a config-file change picks up on the
// next page load without a rebuild.
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Modern UI font — Inter is the de-facto open alternative to Google Sans
// (used by Vercel, OpenAI, etc.). next/font/google self-hosts at build,
// no runtime fetch, no FOUT. Exposed as --font-sans for globals.css.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

// Metadata + viewport are exported as functions so they run per-request
// instead of being baked at build (Next allows both — async/sync funcs
// trigger dynamic evaluation). Lets the config file changes flow without
// rebuild.
export async function generateMetadata(): Promise<Metadata> {
  const { config } = loadMagpieConfig()
  return {
    title: config.name,
    description: config.tagline,
    icons: { apple: config.icon192, icon: config.icon192 },
  }
}

export async function generateViewport(): Promise<Viewport> {
  const { themeColor } = loadMagpieConfig()
  return { themeColor, width: 'device-width', initialScale: 1 }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { config, themeCss, customCss, allowedThemeIds, defaultTheme, flags, locales, localeCodes, defaultLocale } = loadMagpieConfig()

  // Resolve the per-request locale: cookie wins, else server default.
  // Done server-side so SSR renders directly in the chosen locale —
  // no hydration mismatch, no first-paint flash.
  const activeLocale = await resolveLocale(localeCodes, defaultLocale)
  const activeTranslations = locales[activeLocale] ?? {}

  // Inline pre-hydration theme bootstrap: build a JS map of allowed theme
  // IDs (built-ins + custom) so the picker's stored choice validates before
  // React hydrates. Also stashes the config on window so client code can
  // read branding (header text, footer link) without a server round-trip.
  const themeBootstrap = `(function(){try{var T={${allowedThemeIds.map(id => `'${id}':1`).join(',')}};var t=localStorage.getItem('magpie_theme');document.documentElement.setAttribute('data-theme',T[t]?t:'${defaultTheme}')}catch(e){}})()`
  const configBootstrap = `window.__MAGPIE=${JSON.stringify({
    name: config.name,
    shortName: config.shortName,
    tagline: config.tagline,
    welcomeMessage: config.welcomeMessage,
    checkForUpdatesUrl: config.checkForUpdatesUrl,
    defaultTheme,
    allowedThemeIds,
    customThemes: config.themes,
    flags,
    locale: activeLocale,
    availableLocales: localeCodes,
  })};`

  return (
    <html lang={activeLocale} className={`h-dvh ${inter.variable}`} suppressHydrationWarning>
      <head>
        {themeCss && (
          <style dangerouslySetInnerHTML={{ __html: themeCss }} />
        )}
        {customCss && (
          // Operator stylesheet, read from <configDir>/custom.css if
          // present. Loaded AFTER the theme block so deployments can
          // override any built-in theme variable (--surface, --header-bg,
          // --font-sans, etc.) or add @font-face / @import rules for
          // custom fonts. The </style> escape guards against accidental
          // injection from the operator's own CSS (comments, selectors).
          <style dangerouslySetInnerHTML={{ __html: customCss.replace(/<\/style/gi, '<\\/style') }} />
        )}
        <script dangerouslySetInnerHTML={{ __html: configBootstrap + themeBootstrap }} />
      </head>
      <body className="h-dvh overflow-hidden">
        <I18nProvider
          locale={activeLocale}
          translations={activeTranslations}
          availableLocales={localeCodes}
        >
          {children}
        </I18nProvider>
      </body>
    </html>
  )
}
