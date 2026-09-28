'use client'

import { useEffect, useMemo, useState } from 'react'
import type { OrderLine } from '@/lib/order-channel-line'

const CHUNK = 200
const MAX_CHUNKS = 5
/** Lines already resolved this session (Order.id -> line | null), so polling refreshes stay cheap. */
const resolved = new Map<string, OrderLine | null>()

/**
 * Line (SocialAccount) each loaded order came from, via GET /api/orders/lines.
 * Read-only; on failure the Canal column silently falls back to `salesChannel` / "Manual".
 */
export function useOrderLines(orderDbIds: string[]): Record<string, OrderLine> {
  const [version, setVersion] = useState(0)
  const key = orderDbIds.join(',')

  useEffect(() => {
    const pending = orderDbIds.filter((id) => id && !resolved.has(id)).slice(0, CHUNK * MAX_CHUNKS)
    if (pending.length === 0) return
    let cancelled = false
    const chunks: string[][] = []
    for (let i = 0; i < pending.length; i += CHUNK) chunks.push(pending.slice(i, i + CHUNK))
    Promise.all(
      chunks.map(async (ids) => {
        try {
          const res = await fetch(`/api/orders/lines?ids=${encodeURIComponent(ids.join(','))}`, { credentials: 'include' })
          if (!res.ok) return
          const json = await res.json()
          const lines = (json?.lines ?? {}) as Record<string, OrderLine>
          for (const id of ids) resolved.set(id, lines[id] ?? null)
        } catch {
          // leave unresolved: fall back silently, retry on the next list change
        }
      }),
    ).then(() => {
      if (!cancelled) setVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useMemo(() => {
    const out: Record<string, OrderLine> = {}
    for (const id of orderDbIds) {
      const line = resolved.get(id)
      if (line) out[id] = line
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])
}
