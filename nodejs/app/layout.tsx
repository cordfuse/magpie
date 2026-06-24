import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quill',
  description: 'Quill — an agent-agnostic AI chatbot framework',
  manifest: '/manifest.json',
  icons: { apple: '/icons/icon-192.png', icon: '/icons/icon-192.png' },
}

export const viewport: Viewport = {
  themeColor: '#282a36',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var T={dracula:1,'one-dark':1,'tokyo-night':1,nord:1,'solarized-dark':1,'gruvbox-dark':1,monokai:1,'catppuccin-mocha':1,'night-owl':1,synthwave:1,'github-dark':1,palenight:1,'solarized-light':1,'github-light':1,'catppuccin-latte':1,'one-light':1,'tokyo-night-light':1,'ayu-light':1,'gruvbox-light':1,'quiet-light':1,'light-plus':1,'material-lighter':1,'nord-light':1,'min-light':1};var t=localStorage.getItem('quill_theme');document.documentElement.setAttribute('data-theme',T[t]?t:'dracula')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full overflow-hidden">
        {children}
      </body>
    </html>
  )
}
