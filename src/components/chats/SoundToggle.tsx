'use client'

import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import {
  isNotificationSoundEnabled,
  playNotificationChime,
  setNotificationSoundEnabled,
} from '@/lib/notification-sound'

/** Speaker button in the inbox header: turns the new-message chime on / off for this browser. */
export function SoundToggle() {
  const [on, setOn] = useState(true)
  useEffect(() => setOn(isNotificationSoundEnabled()), [])
  const label = on ? 'Sonido de mensajes nuevos: activado' : 'Sonido de mensajes nuevos: desactivado'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={() => {
        const next = !on
        setOn(next)
        setNotificationSoundEnabled(next)
        // A click is a user gesture: the preview also unlocks audio in the browser.
        if (next) playNotificationChime(true)
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
      data-testid="chat-sound-toggle"
    >
      {on ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
    </button>
  )
}
