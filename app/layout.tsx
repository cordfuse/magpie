import type { Metadata, Viewport } from 'next'
import './globals.css'
import UpdateBanner from './UpdateBanner'

export const metadata: Metadata = {
  title: 'Quill',
  description: 'Quill — an agent-agnostic AI chatbot framework',
  manifest: '/manifest.json',
  icons: { apple: '/icons/icon-192.png', icon: '/icons/icon-192.png' },
}

export const viewport: Viewport = {
  themeColor: '#202124',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('quill_theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full overflow-hidden">
        {children}
        <UpdateBanner />
      </body>
    </html>
  )
}
