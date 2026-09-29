'use client'

import { useEffect, useRef, useState } from 'react'
import { presenceLabel, type PresenceState } from '@/lib/chat-presence'

const HEARTBEAT_MS = 15_000
const POLL_MS = 5_000
const TYPING_THROTTLE_MS = 3_000

type Person = { userId: string; name: string; state: PresenceState }

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

/**
 * Presence for the open chat: heartbeat "viewing" every 15 s while the tab is visible, "typing"
 * when the composer text changes (≤ 1 / 3 s), and read who else is here every 5 s. Only the open
 * thread is polled. Failures are silent (presence is a nice-to-have, never blocks the inbox).
 */
export function useChatPresence(conversationId: string | null, draft: string): string {
  const [people, setPeople] = useState<Person[]>([])
  const lastTypingRef = useRef(0)
  const firstDraftRef = useRef(true)

  useEffect(() => {
    setPeople([])
    firstDraftRef.current = true
    if (!conversationId) return
    const url = `/api/chat/conversations/${encodeURIComponent(conversationId)}/presence`
    let stopped = false

    const post = async (state: PresenceState | 'left') => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
          keepalive: state === 'left',
        })
        const json = (await res.json().catch(() => null)) as { success?: boolean; people?: Person[] } | null
        if (!stopped && res.ok && json?.success && Array.isArray(json.people)) setPeople(json.people)
      } catch {
        /* presence is best-effort */
      }
    }
    const poll = async () => {
      if (!visible()) return
      try {
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as { success?: boolean; people?: Person[] } | null
        if (!stopped && res.ok && json?.success && Array.isArray(json.people)) setPeople(json.people)
      } catch {
        /* ignore */
      }
    }

    void post('viewing')
    const beat = window.setInterval(() => {
      if (visible()) void post('viewing')
    }, HEARTBEAT_MS)
    const tick = window.setInterval(() => void poll(), POLL_MS)
    const onVisible = () => {
      if (visible()) void post('viewing')
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(beat)
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
      void post('left')
    }
  }, [conversationId])

  // Typing: any composer change on this chat (skip the initial value when switching chats).
  useEffect(() => {
    if (!conversationId) return
    if (firstDraftRef.current) {
      firstDraftRef.current = false
      return
    }
    if (!draft.trim()) return
    const now = Date.now()
    if (now - lastTypingRef.current < TYPING_THROTTLE_MS) return
    lastTypingRef.current = now
    void fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/presence`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'typing' }),
    }).catch(() => undefined)
  }, [conversationId, draft])

  return presenceLabel(people)
}
