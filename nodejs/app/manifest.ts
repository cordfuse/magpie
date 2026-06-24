import type { MetadataRoute } from 'next'
import { loadQuillConfig } from '@/lib/config'

// PWA manifest. Read from quill.config.json on each request so dropping a
// new config file picks up immediately (browser/OS will still cache the
// installed PWA's shortcut icon — that's outside our control).
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function manifest(): MetadataRoute.Manifest {
  const { config, themeColor } = loadQuillConfig()
  return {
    id: `/?app=${config.shortName.toLowerCase()}`,
    name: config.name,
    short_name: config.shortName,
    description: config.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: themeColor,
    theme_color: themeColor,
    icons: [
      { src: config.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: config.icon192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: config.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: config.icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
