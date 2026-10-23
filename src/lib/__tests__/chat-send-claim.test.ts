import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  claimChatSend,
  markChatSendDelivered,
  releaseChatSend,
  resolveDeliveredOutboundRow,
} from '../chat-send-claim'
import { settleOptimisticOutboundWithoutRow, type ChatInboxMessage } from '../chat-inbox'

type Row = { status: string; providerMessageId: string | null; messageId: string | null; createdAt: Date; updatedAt: Date }

/** In-memory "ChatSendClaim" that answers the exact raw queries chat-send-claim.ts issues. */
function fakeClaimDb(opts: { missingTable?: boolean } = {}) {
  const rows = new Map<string, Row>()
  const calls: string[] = []
  const key = (t: unknown, c: unknown) => `${t}::${c}`
  const missing = () => Object.assign(new Error('relation "ChatSendClaim" does not exist'), { code: '42P01' })
  const run = (strings: TemplateStringsArray, values: unknown[]) => {
    const sql = strings.join('?')
    calls.push(sql)
    if (opts.missingTable) throw missing()
    if (sql.includes('INSERT INTO "ChatSendClaim"')) {
      const [t, c, now] = values as [string, string, Date]
      if (rows.has(key(t, c))) return []
      rows.set(key(t, c), { status: 'sending', providerMessageId: null, messageId: null, createdAt: now, updatedAt: now })
      return [{ ok: 1 }]
    }
    if (sql.includes('SELECT "status"')) {
      const row = rows.get(key(values[0], values[1]))
      return row ? [row] : []
    }
    if (sql.includes(`SET "status" = 'sending'`)) {
      const [now, t, c, staleBefore, deliveredAfter] = values as [Date, string, string, Date, Date]
      const row = rows.get(key(t, c))
      const free =
        row &&
        (row.status === 'failed' ||
          (row.status === 'sending' && row.updatedAt < staleBefore) ||
          (row.status === 'delivered' && row.updatedAt < deliveredAfter))
      if (!row || !free) return []
      Object.assign(row, { status: 'sending', updatedAt: now, providerMessageId: null, messageId: null })
      return [{ ok: 1 }]
    }
    if (sql.includes(`SET "status" = 'delivered'`)) {
      const [now, pmid, mid, t, c] = values as [Date, string | null, string | null, string, string]
      const row = rows.get(key(t, c))
      if (row) Object.assign(row, { status: 'delivered', updatedAt: now, providerMessageId: pmid ?? row.providerMessageId, messageId: mid ?? row.messageId })
      return 1
    }
    if (sql.includes(`SET "status" = 'failed'`)) {
      const [now, t, c] = values as [Date, string, string]
      const row = rows.get(key(t, c))
      if (row?.status === 'sending') Object.assign(row, { status: 'failed', updatedAt: now })
      return 1
    }
    if (sql.includes('DELETE FROM "ChatSendClaim"')) return 0
    throw new Error(`unexpected sql: ${sql}`)
  }
  const db = {
    $queryRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => run(strings, values)) as any,
    $executeRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => run(strings, values)) as any,
  }
  return { db, rows, calls }
}

describe('chat send claim (one send per business + clientRequestId)', () => {
  it('the first request owns the id; a concurrent repeat is in flight, never a second send', async () => {
    const { db } = fakeClaimDb()
    assert.deepEqual(await claimChatSend('t1', 'crid-1', db), { kind: 'claimed' })
    assert.deepEqual(await claimChatSend('t1', 'crid-1', db), { kind: 'in_flight' })
  })

  it('is tenant scoped: the same id in another business is its own send', async () => {
    const { db } = fakeClaimDb()
    assert.equal((await claimChatSend('t1', 'same-id', db)).kind, 'claimed')
    assert.equal((await claimChatSend('t2', 'same-id', db)).kind, 'claimed')
  })

  it('a send Meta refused is released, so Retry sends it again', async () => {
    const { db } = fakeClaimDb()
    await claimChatSend('t1', 'crid-2', db)
    await releaseChatSend('t1', 'crid-2', db)
    assert.equal((await claimChatSend('t1', 'crid-2', db)).kind, 'claimed')
  })

  it('a delivered send answers "delivered" with its ids (Retry never re-sends)', async () => {
    const { db } = fakeClaimDb()
    await claimChatSend('t1', 'crid-3', db)
    await markChatSendDelivered('t1', 'crid-3', { providerMessageId: 'wamid.X', messageId: 'msg-1' }, db)
    assert.deepEqual(await claimChatSend('t1', 'crid-3', db), {
      kind: 'delivered',
      providerMessageId: 'wamid.X',
      messageId: 'msg-1',
    })
    // A delivered claim is not released by a late failure path.
    await releaseChatSend('t1', 'crid-3', db)
    assert.equal((await claimChatSend('t1', 'crid-3', db)).kind, 'delivered')
  })

  it('after the 24 h window the same id is a new send (guía re-send keys stay usable)', async () => {
    const { db } = fakeClaimDb()
    const t0 = new Date('2026-10-22T10:00:00Z')
    await claimChatSend('t1', 'guia:g1:c1', db, t0)
    await markChatSendDelivered('t1', 'guia:g1:c1', { providerMessageId: 'wamid.G' }, db)
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000)
    assert.equal((await claimChatSend('t1', 'guia:g1:c1', db, later)).kind, 'claimed')
  })

  it('a request that died mid-send (stale claim) can be taken over by a retry', async () => {
    const { db } = fakeClaimDb()
    const t0 = new Date('2026-10-22T10:00:00Z')
    await claimChatSend('t1', 'crid-4', db, t0)
    assert.equal((await claimChatSend('t1', 'crid-4', db, new Date(t0.getTime() + 30_000))).kind, 'in_flight')
    assert.equal((await claimChatSend('t1', 'crid-4', db, new Date(t0.getTime() + 3 * 60_000))).kind, 'claimed')
  })

  it('without 057 applied (or without an id) sending still works: unavailable, no throw', async () => {
    const missing = fakeClaimDb({ missingTable: true })
    assert.deepEqual(await claimChatSend('t1', 'crid-5', missing.db), { kind: 'unavailable' })
    await markChatSendDelivered('t1', 'crid-5', { providerMessageId: 'x' }, missing.db)
    await releaseChatSend('t1', 'crid-5', missing.db)

    const fresh = fakeClaimDb()
    assert.deepEqual(await claimChatSend('t1', null, fresh.db), { kind: 'unavailable' })
    assert.deepEqual(await claimChatSend('t1', 'bad id with spaces', fresh.db), { kind: 'unavailable' })
    assert.equal(fresh.calls.length, 0)
  })
})

describe('resolveDeliveredOutboundRow (echo stored first)', () => {
  function fakeMessages(row: Record<string, unknown> | null) {
    const updates: any[] = []
    const finds: any[] = []
    return {
      updates,
      finds,
      db: {
        chatMessage: {
          findFirst: async (args: any) => {
            finds.push(args)
            return row
          },
          updateMany: async (args: any) => {
            updates.push(args)
            return { count: 1 }
          },
        },
      },
    }
  }
  const base = {
    tenantId: 't1',
    socialAccountId: 'sa1',
    providerMessageId: 'wamid.ECHO',
    clientRequestId: 'crid-9',
    metadata: { clientRequestId: 'crid-9', senderUserId: 'u1', to: '506' },
  }

  it('a fresh write is used as is', async () => {
    const m = fakeMessages(null)
    const out = await resolveDeliveredOutboundRow(
      m.db,
      { ok: true, duplicate: false, messageId: 'm1', conversationId: 'c1' } as any,
      base,
    )
    assert.deepEqual(out, { messageId: 'm1', conversationId: 'c1' })
    assert.equal(m.finds.length, 0)
  })

  it('a duplicate resolves to the echo row (tenant + line scoped) and stamps our clientRequestId', async () => {
    const m = fakeMessages({ id: 'echo-1', conversationId: 'c1', metadata: { webhookField: 'smb_message_echoes' } })
    const out = await resolveDeliveredOutboundRow(
      m.db,
      { ok: true, duplicate: true, messageId: null, conversationId: null, reason: 'duplicate' },
      base,
    )
    assert.deepEqual(out, { messageId: 'echo-1', conversationId: 'c1' })
    assert.deepEqual(m.finds[0].where, { tenantId: 't1', socialAccountId: 'sa1', providerMessageId: 'wamid.ECHO' })
    assert.equal(m.updates[0].where.tenantId, 't1')
    assert.equal(m.updates[0].data.metadata.clientRequestId, 'crid-9')
    assert.equal(m.updates[0].data.metadata.webhookField, 'smb_message_echoes')
    assert.equal(m.updates[0].data.metadata.senderUserId, 'u1')
  })

  it('a failed write without a Meta id cannot be resolved (caller answers persisted:false)', async () => {
    const m = fakeMessages(null)
    const out = await resolveDeliveredOutboundRow(m.db, { ok: false, reason: 'error' }, { ...base, providerMessageId: null })
    assert.equal(out, null)
  })
})

describe('client: a delivered message never shows as failed', () => {
  const bubble = (status: string): ChatInboxMessage => ({
    id: 'optimistic:crid-1',
    direction: 'outbound',
    content: 'hola',
    sentAt: '2026-10-22T10:00:00.000Z',
    receivedAt: null,
    deliveryStatus: status,
    clientRequestId: 'crid-1',
  })

  it('persisted:false turns the bubble "sent"; inFlight keeps it "sending"', () => {
    assert.equal(settleOptimisticOutboundWithoutRow([bubble('pending')], 'crid-1', {})[0].deliveryStatus, 'sent')
    assert.equal(settleOptimisticOutboundWithoutRow([bubble('failed')], 'crid-1', {})[0].deliveryStatus, 'sent')
    assert.equal(settleOptimisticOutboundWithoutRow([bubble('pending')], 'crid-1', { inFlight: true })[0].deliveryStatus, 'pending')
    assert.equal(settleOptimisticOutboundWithoutRow([bubble('read')], 'crid-1', {})[0].deliveryStatus, 'read')
  })
})

describe('send routes: claim before Meta, success after delivery', () => {
  const route = readFileSync('src/app/api/chat/send/route.ts', 'utf8')
  const media = readFileSync('src/lib/chat-send-media-core.ts', 'utf8')

  it('the claim and the stored-id lookup run before the first Meta call', () => {
    for (const [name, src] of [['send', route], ['send-media', media]] as const) {
      const firstMeta = Math.min(
        ...['await fetch(', 'uploadInstagramImage('].map((s) => src.indexOf(s)).filter((i) => i > 0),
      )
      assert.ok(src.indexOf('findOutboundByClientRequestId(') < firstMeta, name)
      assert.ok(src.indexOf('claimChatSend(') < firstMeta, name)
      assert.match(src, /finally \{\s*\/\/[^\n]*\n\s*if \(ownsClaim && !delivered && !ambiguous\) await releaseChatSend/, name)
    }
  })

  it('after Meta accepted, no path answers an error', () => {
    for (const [name, src] of [['send', route], ['send-media', media]] as const) {
      const after = src.slice(src.indexOf("if (ownsClaim && !delivered && !ambiguous)"))
      const persistEnd = after.indexOf('delivered but not stored\', error')
      assert.ok(persistEnd > 0, name)
      const persist = after.slice(0, persistEnd)
      assert.doesNotMatch(persist, /jsonError\(|ok: false/, name)
    }
    assert.doesNotMatch(media, /\{ sent: true \}/)
  })
})

describe('SecureDog fixes (DATA-CLAIM-1, AUTH-SEND-2)', () => {
  it('a browser cannot pre-claim a server-only guía id', async () => {
    const { browserClientRequestId } = await import('../chat-send-claim')
    assert.equal(browserClientRequestId('8d2c6a6e-1f3b-4b2a-9e1e-1234567890ab'), '8d2c6a6e-1f3b-4b2a-9e1e-1234567890ab')
    assert.equal(browserClientRequestId('guia:g1:c1'), null)
    assert.equal(browserClientRequestId('GUIA:g1:c1'), null)
    assert.equal(browserClientRequestId('bad id'), null)
    assert.equal(browserClientRequestId(undefined), null)
    for (const p of ['src/app/api/chat/send/route.ts', 'src/app/api/chat/send-media/route.ts']) {
      assert.match(readFileSync(p, 'utf8'), /browserClientRequestId/, p)
    }
  })

  it('both send routes refuse other origins; delivered lookups stay on the line', () => {
    const route = readFileSync('src/app/api/chat/send/route.ts', 'utf8')
    const mediaRoute = readFileSync('src/app/api/chat/send-media/route.ts', 'utf8')
    assert.match(route, /if \(!isSameOriginJson\(request\)\) return jsonError\('Origen no permitido\.', 403\)/)
    assert.match(mediaRoute, /if \(!isSameOriginRequest\(request\)\) return jsonError\('Origen no permitido\.', 403\)/)
    assert.match(route, /where: \{ id: claim\.messageId, tenantId, socialAccountId \}/)
    assert.match(readFileSync('src/lib/chat-send-media-core.ts', 'utf8'), /where: \{ id: claim\.messageId, tenantId, socialAccountId: found\.id \}/)
    assert.doesNotMatch(readFileSync('src/lib/chat-outbound-upload.ts', 'utf8'), /withCredentials/)
  })
})

describe('verifier fixes (Lane A)', () => {
  const inbox = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')

  it('phone: a notification link is cleaned in place before the thread entry is pushed', () => {
    const clean = inbox.indexOf("window.history.replaceState({}, '', '/chats')")
    const open = inbox.indexOf('openConversationById(deepLinkId)')
    assert.ok(clean > 0 && open > clean)
    assert.match(inbox, /c !== handledDeepLinkRef\.current/)
  })

  it('Retry on a stored row Meta failed later is a new send with a new id', () => {
    assert.match(inbox, /handleSendMessage\(\{ preventDefault\(\) \{\} \} as FormEvent, \{ resendContent: row\.content \}\)/)
    assert.match(inbox, /if \(opts\?\.resendContent === undefined\) setMessageInput\(''\)/)
  })

  it('"in flight" is re-checked a few times, then becomes Reintentar; media keeps its job', () => {
    assert.match(inbox, /if \(attempt > IN_FLIGHT_RECHECKS\)/)
    assert.match(inbox, /scheduleInFlightRecheck\(conversationId, clientRequestId, \(\) => deliverMedia\(job\)\)/)
    const media = inbox.slice(inbox.indexOf('async function deliverMedia'))
    // The in-flight branch re-checks and returns BEFORE the job is dropped (Reintentar still has it).
    assert.match(
      media,
      /parsed\.data\.inFlight === true\) \{[\s\S]*?scheduleInFlightRecheck\([\s\S]*?return\s*\}\s*inFlightChecksRef\.current\.delete\(clientRequestId\)\s*mediaJobsRef\.current\.delete\(clientRequestId\)/,
    )
  })

  it('a Meta timeout keeps the claim (ambiguous), uploads time out', () => {
    for (const p of ['src/app/api/chat/send/route.ts', 'src/lib/chat-send-media-core.ts']) {
      assert.match(readFileSync(p, 'utf8'), /if \(ownsClaim && !delivered && !ambiguous\) await releaseChatSend/, p)
    }
    assert.match(readFileSync('src/lib/chat-outbound-upload.ts', 'utf8'), /xhr\.timeout = UPLOAD_TIMEOUT_MS/)
  })

  it('settled bubbles keep their time; reconcile never leaves two rows with one id', async () => {
    const { compareThreadMessages, reconcileOptimisticOutbound } = await import('../chat-inbox')
    const stored = { id: 'm2', sentAt: '2026-10-22T10:05:00.000Z', deliveryStatus: 'read' }
    const ghost = { id: 'optimistic:a', sentAt: '2026-10-22T10:00:00.000Z', deliveryStatus: 'sent' }
    const pending = { id: 'optimistic:b', sentAt: '2026-10-22T09:00:00.000Z', deliveryStatus: 'pending' }
    assert.deepEqual([stored, pending, ghost].sort(compareThreadMessages).map((m) => m.id), ['optimistic:a', 'm2', 'optimistic:b'])

    const echo = { id: 'e1', direction: 'outbound', content: 'hola', sentAt: '2026-10-22T10:00:01.000Z', receivedAt: null, deliveryStatus: 'sent' }
    const bubble = { id: 'optimistic:c', direction: 'outbound', content: 'hola', sentAt: '2026-10-22T10:00:00.000Z', receivedAt: null, deliveryStatus: 'pending', clientRequestId: 'c' }
    const out = reconcileOptimisticOutbound([echo, bubble] as any, { ...echo, clientRequestId: 'c', metadata: { clientRequestId: 'c' } } as any)
    assert.deepEqual(out.map((m) => m.id), ['e1'])
  })
})
