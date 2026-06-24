import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { loadQuillConfig } from '@/lib/config'
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
  const { config } = loadQuillConfig()
  return {
    title: config.name,
    description: config.tagline,
    icons: { apple: config.icon192, icon: config.icon192 },
  }
}

export async function generateViewport(): Promise<Viewport> {
  const { themeColor } = loadQuillConfig()
  return { themeColor, width: 'device-width', initialScale: 1 }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { config, themeCss, allowedThemeIds, defaultTheme, flags } = loadQuillConfig()

  // Inline pre-hydration theme bootstrap: build a JS map of allowed theme
  // IDs (built-ins + custom) so the picker's stored choice validates before
  // React hydrates. Also stashes the config on window so client code can
  // read branding (header text, footer link) without a server round-trip.
  const themeBootstrap = `(function(){try{var T={${allowedThemeIds.map(id => `'${id}':1`).join(',')}};var t=localStorage.getItem('quill_theme');document.documentElement.setAttribute('data-theme',T[t]?t:'${defaultTheme}')}catch(e){}})()`
  const configBootstrap = `window.__QUILL=${JSON.stringify({
    name: config.name,
    shortName: config.shortName,
    tagline: config.tagline,
    welcomeMessage: config.welcomeMessage,
    checkForUpdatesUrl: config.checkForUpdatesUrl,
    defaultTheme,
    allowedThemeIds,
    customThemes: config.themes,
    flags,
  })};`

  return (
    <html lang="en" className={`h-dvh ${inter.variable}`} suppressHydrationWarning>
      <head>
        {themeCss && (
          <style dangerouslySetInnerHTML={{ __html: themeCss }} />
        )}
        <script dangerouslySetInnerHTML={{ __html: configBootstrap + themeBootstrap }} />
      </head>
      <body className="h-dvh overflow-hidden">
        {children}
      </body>
    </html>
  )
}
