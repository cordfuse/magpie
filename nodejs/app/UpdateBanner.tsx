'use client'

import { useEffect, useState } from 'react'

export default function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handleRegistration = (reg: ServiceWorkerRegistration) => {
      // Already waiting on load (e.g. user had tab open during deploy)
      if (reg.waiting) {
        setWaiting(reg.waiting)
        return
      }
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing
        if (!newSW) return
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(newSW)
          }
        })
      })
    }

    navigator.serviceWorker.ready.then(handleRegistration)

    // Reload when new SW takes control
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    })
  }, [])

  if (!waiting) return null

  const update = () => {
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-white/10 bg-surface-2 px-4 py-2.5 text-sm shadow-xl backdrop-blur">
      <span className="text-fg-2">Update available</span>
      <button
        onClick={update}
        className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-fg-1 hover:bg-white/20 transition-colors"
      >
        Refresh
      </button>
    </div>
  )
}
