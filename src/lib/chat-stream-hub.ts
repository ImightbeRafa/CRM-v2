/**
 * Live inbox ticks (SSE helper). One shared poller per tenant per process: while at least one tab is
 * connected it reads the tenant's newest conversation revision every few seconds and tells every
 * listener when it moves. Frames carry NO conversation or message data — the client then calls the
 * existing /api/chat/conversations/changes endpoint, so scoping and DTOs stay in one place.
 * Works with any number of containers (each polls the database itself); no pub/sub needed.
 */
import 'server-only'

import { prisma } from '@/lib/db'

export const CHAT_STREAM_POLL_MS = 2_000
export const CHAT_STREAM_MAX_PER_TENANT = 50
export const CHAT_STREAM_MAX_TOTAL = 500

export function chatSseEnabled(): boolean {
  const v = (process.env.CHAT_SSE || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on'
}

type Listener = (revision: string) => void
type TenantHub = { listeners: Set<Listener>; timer: ReturnType<typeof setInterval> | null; last: string | null; busy: boolean }

const hubs = new Map<string, TenantHub>()
let total = 0

type RevisionReader = (tenantId: string) => Promise<string | null>

async function defaultReadRevision(tenantId: string): Promise<string | null> {
  const row = await prisma.chatConversation.aggregate({
    where: { tenantId },
    _max: { revision: true },
  })
  const rev = row._max.revision
  return rev === null || rev === undefined ? null : rev.toString()
}

let readRevision: RevisionReader = defaultReadRevision

/** Tests only: replace the database read. */
export function setChatStreamRevisionReader(reader: RevisionReader | null) {
  readRevision = reader ?? defaultReadRevision
}

async function pollTenant(tenantId: string, hub: TenantHub) {
  if (hub.busy) return
  hub.busy = true
  try {
    const rev = await readRevision(tenantId)
    if (rev !== null && hub.last !== null && rev !== hub.last) {
      for (const listener of hub.listeners) {
        try {
          listener(rev)
        } catch {
          /* a dead connection must not stop the others */
        }
      }
    }
    if (rev !== null) hub.last = rev
  } catch {
    /* transient DB error: next tick retries */
  } finally {
    hub.busy = false
  }
}

/** Returns an unsubscribe function, or null when the connection caps are reached. */
export function subscribeChatTicks(tenantId: string, listener: Listener): (() => void) | null {
  if (total >= CHAT_STREAM_MAX_TOTAL) return null
  let hub = hubs.get(tenantId)
  if (hub && hub.listeners.size >= CHAT_STREAM_MAX_PER_TENANT) return null
  if (!hub) {
    hub = { listeners: new Set(), timer: null, last: null, busy: false }
    hubs.set(tenantId, hub)
  }
  hub.listeners.add(listener)
  total += 1
  if (!hub.timer) {
    const h = hub
    h.timer = setInterval(() => void pollTenant(tenantId, h), CHAT_STREAM_POLL_MS)
    void pollTenant(tenantId, h)
  }
  let done = false
  return () => {
    if (done) return
    done = true
    const current = hubs.get(tenantId)
    if (!current) return
    if (current.listeners.delete(listener)) total = Math.max(0, total - 1)
    if (current.listeners.size === 0) {
      if (current.timer) clearInterval(current.timer)
      hubs.delete(tenantId)
    }
  }
}

export function chatStreamStats() {
  return { tenants: hubs.size, listeners: total }
}
