import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import {
  ERASE_DELAY_MS,
  MAX_RETRY_ATTEMPTS,
  STORAGE_BATCH,
  checkCallbackPayload,
  describeDeletionStatus,
  isConfirmationCode,
  isMetaUserId,
  metaUserKey,
  processMetaDataRequest,
  removeWithinBudget,
  retryOpenDeletionRequests,
  safeTenantChatPaths,
  type DeletionRequestRow,
  type DeletionStore,
  type MetaLineRef,
} from '../meta-data-deletion/core'
import { parseMetaSignedRequest } from '../meta-signed-request'

const SECRET = 'test-secret'
process.env.NEXTAUTH_SECRET = SECRET
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const DAY = 24 * 60 * 60 * 1000

type Fake = DeletionStore & {
  rows: Map<string, DeletionRequestRow & { metaUserKey: string }>
  lines: Map<string, MetaLineRef>
  erased: string[]
  disconnected: string[]
  notified: Array<{ ids: string[]; eraseAfter: Date }>
  tableMissing: boolean
  eraseFails: number
  disconnectFails: number
}

function fakeStore(byUser: Record<string, MetaLineRef[]>, paths: Record<string, string[]> = {}): Fake {
  const lines = new Map<string, MetaLineRef>()
  for (const [user, ls] of Object.entries(byUser)) for (const l of ls) lines.set(l.id, { isActive: true, hasToken: true, metaUserId: user, ...l })
  const store: Fake = {
    rows: new Map(),
    lines,
    erased: [],
    disconnected: [],
    notified: [],
    tableMissing: false,
    eraseFails: 0,
    disconnectFails: 0,
    async findLines(id) {
      return (byUser[id] ?? []).map((l) => ({ ...lines.get(l.id)! }))
    },
    async findLinesByIds(ids) {
      return ids.filter((id) => lines.has(id)).map((id) => ({ ...lines.get(id)! }))
    },
    async collectPaths(line) {
      return store.erased.includes(line.id) ? [] : paths[line.id] ?? []
    },
    async eraseLine(line) {
      if (store.eraseFails > 0) {
        store.eraseFails -= 1
        throw Object.assign(new Error('db down'), { code: 'P1001' })
      }
      store.erased.push(line.id)
      lines.set(line.id, { ...lines.get(line.id)!, isActive: false })
    },
    async disconnectLine(line) {
      if (store.disconnectFails > 0) {
        store.disconnectFails -= 1
        throw Object.assign(new Error('db down'), { code: 'P1001' })
      }
      store.disconnected.push(line.id)
      lines.set(line.id, { ...lines.get(line.id)!, isActive: false, hasToken: false })
    },
    async notifyScheduled(ls, eraseAfter) {
      store.notified.push({ ids: ls.map((l) => l.id), eraseAfter })
    },
    async findRecentRequest(key, kind, since) {
      if (store.tableMissing) return null
      const hits = [...store.rows.values()].filter((r) => r.metaUserKey === key && r.kind === kind && r.createdAt >= since)
      return hits.at(-1) ?? null
    },
    async insertRequest(row) {
      if (store.tableMissing) return false
      store.rows.set(row.id, { ...row })
      return true
    },
    async updateRequest(id, patch) {
      const row = store.rows.get(id)
      if (row) store.rows.set(id, { ...row, ...patch, updatedAt: new Date() })
    },
    async listOpenRequests(olderThan, limit) {
      return [...store.rows.values()]
        .filter((r) => ['received', 'pending', 'pending_storage'].includes(r.status) && r.updatedAt < olderThan)
        .slice(0, limit)
    },
  }
  return store
}

const lineA: MetaLineRef = { id: 'sa_ig', tenantId: 't1', platform: 'instagram' }
const lineB: MetaLineRef = { id: 'sa_wa', tenantId: 't1', platform: 'whatsapp' }
const after = (ms: number) => () => new Date(Date.now() + ms)
const opts = { secret: SECRET }

test('confirmation codes and the HMAC user key (never the raw id, needs the secret)', () => {
  const key = metaUserKey('1234567890', SECRET)
  assert.match(key, /^[a-f0-9]{64}$/)
  assert.notEqual(key, crypto.createHash('sha256').update('1234567890').digest('hex'))
  assert.notEqual(key, metaUserKey('1234567890', 'other'))
  assert.throws(() => metaUserKey('1', ''), /NEXTAUTH_SECRET/)
  assert.ok(isConfirmationCode('BETSY-DEL-0123456789AB'))
  assert.ok(!isConfirmationCode('BETSY-DEL-0123'))
  assert.ok(!isConfirmationCode("BETSY-DEL-0123456789AB' OR 1=1"))
  assert.ok(isMetaUserId('123'))
  assert.ok(!isMetaUserId(123), 'a JSON number (could be rounded past 2^53) is refused')
})

test('callback payload: fresh, a real callback (not a login signedRequest), string user id', () => {
  const now = 1_800_000_000
  assert.deepEqual(checkCallbackPayload({ algorithm: 'HMAC-SHA256', issued_at: now - 60, user_id: '42' }, now), { ok: true, userId: '42' })
  assert.equal(checkCallbackPayload({ issued_at: now - 2 * 86_400, user_id: '42' }, now).ok, false, 'older than 24 h (replay)')
  assert.equal(checkCallbackPayload({ issued_at: now + 3_600, user_id: '42' }, now).ok, false, 'from the future')
  assert.equal(checkCallbackPayload({ user_id: '42' }, now).ok, false, 'no issued_at')
  assert.equal(checkCallbackPayload({ issued_at: now, user_id: '42', code: 'abc' }, now).ok, false, 'JS SDK login signedRequest')
  assert.equal(checkCallbackPayload({ issued_at: now, user_id: '42', oauth_token: 'x' }, now).ok, false)
  assert.equal(checkCallbackPayload({ issued_at: now, user_id: 42 }, now).ok, false)
})

test('only this business’s chat files can be deleted', () => {
  const out = safeTenantChatPaths('t1', [
    'chat-media/t1/msg1',
    'chat-media/t1/avatars/conv1',
    'chat-media/t1/msg1',
    'chat-media/t2/msg9',
    'chat-media/t1/../t2/x',
    'chat-media/t1/',
    'agent-sources/t1/a',
    'https://cdn.example/x.jpg',
    null,
    undefined,
  ])
  assert.deepEqual(out, ['chat-media/t1/msg1', 'chat-media/t1/avatars/conv1'])
})

test('deletion: lines disconnected and owner told at once; erase only after 72 hours', async () => {
  const store = fakeStore({ '111': [lineA, lineB] }, { sa_ig: ['chat-media/t1/m1'], sa_wa: ['chat-media/t1/m2', 'chat-media/t1/m1'] })
  const out = await processMetaDataRequest({ metaUserId: '111', kind: 'deletion' }, store, opts)
  assert.equal(out.status, 'received')
  assert.ok(isConfirmationCode(out.confirmationCode))
  assert.deepEqual(store.disconnected, ['sa_ig', 'sa_wa'])
  assert.deepEqual(store.erased, [], 'nothing erased yet')
  assert.equal(store.notified.length, 1)
  const row = [...store.rows.values()][0]!
  assert.equal(store.notified[0]!.eraseAfter.getTime(), row.createdAt.getTime() + ERASE_DELAY_MS)
  assert.ok(!JSON.stringify(row).includes('"111"'), 'raw Meta id never stored')

  const removed: string[] = []
  const early = await retryOpenDeletionRequests(store, async (p) => void removed.push(...p), { now: after(DAY) })
  assert.equal(early.waiting, 1)
  assert.deepEqual(store.erased, [])

  const res = await retryOpenDeletionRequests(store, async (p) => void removed.push(...p), { now: after(3 * DAY + 60_000) })
  assert.equal(res.completed, 1)
  assert.deepEqual(store.erased, ['sa_ig', 'sa_wa'])
  assert.deepEqual(removed.sort(), ['chat-media/t1/m1', 'chat-media/t1/m2'])
  assert.equal(store.rows.get(row.id)!.status, 'completed')
})

test('a line reconnected during the wait is never erased automatically: manual review, reported', async () => {
  const store = fakeStore({ '112': [lineA] })
  const failures: string[] = []
  await processMetaDataRequest({ metaUserId: '112', kind: 'deletion' }, store, opts)
  store.lines.set('sa_ig', { ...store.lines.get('sa_ig')!, isActive: true, hasToken: true }) // the owner reconnected
  const res = await retryOpenDeletionRequests(store, async () => {}, { now: after(4 * DAY), onFailure: (s, c) => failures.push(`${s}:${c}`) })
  assert.equal(res.failed, 1)
  assert.deepEqual(store.erased, [])
  assert.equal([...store.rows.values()][0]!.lastErrorCode, 'line_reconnected')
  assert.ok(failures.some((f) => f.startsWith('gave_up:') && f.endsWith(':line_reconnected')))
  assert.match(describeDeletionStatus('failed').body, /volvió a conectar/)
})

test('a reconnect whose subscribe failed (inactive, but a token again) is still a reconnect: no erase', async () => {
  const store = fakeStore({ '113': [lineA] })
  await processMetaDataRequest({ metaUserId: '113', kind: 'deletion' }, store, opts)
  store.lines.set('sa_ig', { ...store.lines.get('sa_ig')!, isActive: false, hasToken: true })
  const res = await retryOpenDeletionRequests(store, async () => {}, { now: after(4 * DAY) })
  assert.equal(res.failed, 1)
  assert.deepEqual(store.erased, [])
})

test('two overlapping requests: an older one never erases a line someone else connected meanwhile', async () => {
  const store = fakeStore({ '114': [lineA] })
  await processMetaDataRequest({ metaUserId: '114', kind: 'deletion' }, store, opts)
  // A new admin reconnected, then asked for deletion too: the line is disconnected again, but names the new admin.
  store.lines.set('sa_ig', { ...store.lines.get('sa_ig')!, isActive: false, hasToken: false, metaUserId: '115' })
  const res = await retryOpenDeletionRequests(store, async () => {}, { now: after(3 * DAY + 60_000) })
  assert.equal(res.failed, 1, 'the first request goes to manual review')
  assert.deepEqual(store.erased, [])
})

test('deletion with no matching line answers no_data, and the page offers the manual route', async () => {
  const store = fakeStore({})
  const out = await processMetaDataRequest({ metaUserId: '222', kind: 'deletion' }, store, opts)
  assert.equal(out.status, 'no_data')
  assert.equal([...store.rows.values()][0]!.status, 'no_data')
  assert.match(describeDeletionStatus('no_data').body, /support@betsycrm\.com.*30 días/)
})

test('a storage failure is not swallowed: pending_storage with the remaining paths, then the cron finishes it', async () => {
  const paths = Array.from({ length: STORAGE_BATCH + 5 }, (_, i) => `chat-media/t1/m${i}`)
  const store = fakeStore({ '333': [lineA] }, { sa_ig: paths })
  await processMetaDataRequest({ metaUserId: '333', kind: 'deletion' }, store, opts)
  const failures: string[] = []
  let calls = 0
  await retryOpenDeletionRequests(
    store,
    async () => {
      calls += 1
      if (calls === 2) throw Object.assign(new Error('storage 503'), { name: 'ChatStorageError' })
    },
    { now: after(3 * DAY + 60_000), onFailure: (stage, code) => failures.push(`${stage}:${code}`) },
  )
  const row = [...store.rows.values()][0]!
  assert.equal(row.status, 'pending_storage')
  assert.deepEqual(failures, ['storage:ChatStorageError'])
  assert.equal(row.pendingPaths.length, 5)
  assert.deepEqual(store.erased, ['sa_ig'], 'the database part is already done')

  store.rows.set(row.id, { ...store.rows.get(row.id)!, updatedAt: new Date(0) })
  const removed: string[] = []
  const res = await retryOpenDeletionRequests(store, async (p) => void removed.push(...p), { now: after(4 * DAY) })
  assert.equal(res.completed, 1)
  assert.equal(removed.length, 5)
  assert.deepEqual(store.rows.get(row.id)!.pendingPaths, [])
})

test('a failure half-way keeps the file paths already found (no "completed" with files left)', async () => {
  const store = fakeStore({ '4441': [lineA, lineB] }, { sa_ig: ['chat-media/t1/ig1'], sa_wa: ['chat-media/t1/wa1'] })
  await processMetaDataRequest({ metaUserId: '4441', kind: 'deletion' }, store, opts)
  const realErase = store.eraseLine
  let n = 0
  store.eraseLine = async (line) => {
    n += 1
    if (n === 2) throw Object.assign(new Error('db blip'), { code: 'P1001' })
    return realErase(line)
  }
  await retryOpenDeletionRequests(store, async () => {}, { now: after(3 * DAY + 60_000) })
  const row = [...store.rows.values()][0]!
  assert.equal(row.status, 'pending')
  assert.deepEqual(row.pendingPaths.sort(), ['chat-media/t1/ig1', 'chat-media/t1/wa1'])
  store.eraseLine = realErase
  store.rows.set(row.id, { ...store.rows.get(row.id)!, updatedAt: new Date(0) })
  const removed: string[] = []
  await retryOpenDeletionRequests(store, async (p) => void removed.push(...p), { now: after(4 * DAY) })
  assert.deepEqual(removed.sort(), ['chat-media/t1/ig1', 'chat-media/t1/wa1'], 'line A’s file is removed although its messages are gone')
  assert.equal(store.rows.get(row.id)!.status, 'completed')
})

test('a failed disconnect is retried and then the 72-hour wait applies', async () => {
  const store = fakeStore({ '444': [lineA] })
  store.disconnectFails = 1
  const out = await processMetaDataRequest({ metaUserId: '444', kind: 'deletion' }, store, opts)
  assert.equal(out.status, 'pending')
  assert.equal(store.notified.length, 0)
  const row = [...store.rows.values()][0]!
  store.rows.set(row.id, { ...row, updatedAt: new Date(0) })
  await retryOpenDeletionRequests(store, async () => {}, { now: after(DAY / 2) })
  assert.deepEqual(store.disconnected, ['sa_ig'])
  assert.equal(store.rows.get(row.id)!.status, 'received')
  assert.equal(store.notified.length, 1)
  assert.deepEqual(store.erased, [])
})

test('after MAX attempts the request is marked failed and reported (status page says manual review)', async () => {
  const store = fakeStore({ '555': [lineA] }, { sa_ig: ['chat-media/t1/m1'] })
  await processMetaDataRequest({ metaUserId: '555', kind: 'deletion' }, store, opts)
  const row = [...store.rows.values()][0]!
  store.rows.set(row.id, { ...row, status: 'pending_storage', pendingPaths: ['chat-media/t1/m1'], attempts: MAX_RETRY_ATTEMPTS - 1, updatedAt: new Date(0) })
  const failures: string[] = []
  const res = await retryOpenDeletionRequests(store, async () => {
    throw new Error('still down')
  }, { now: after(4 * DAY), onFailure: (stage) => failures.push(stage) })
  assert.equal(res.failed, 1)
  assert.equal(store.rows.get(row.id)!.status, 'failed')
  assert.ok(failures.includes('gave_up'))
  assert.match(describeDeletionStatus('failed').body, /support@betsycrm\.com/)
})

test('Meta resending (or a replay) within 24 h gets the same code: no second request', async () => {
  const store = fakeStore({ '666': [lineA] })
  const first = await processMetaDataRequest({ metaUserId: '666', kind: 'deletion' }, store, opts)
  const again = await processMetaDataRequest({ metaUserId: '666', kind: 'deletion' }, store, { ...opts, now: after(20 * 60 * 60 * 1000) })
  assert.equal(again.confirmationCode, first.confirmationCode)
  assert.ok(again.reused)
  assert.equal(store.rows.size, 1)
})

test('deauthorize only disconnects (history kept), never erases', async () => {
  const store = fakeStore({ '777': [lineA, lineB] }, { sa_ig: ['chat-media/t1/m1'] })
  const out = await processMetaDataRequest({ metaUserId: '777', kind: 'deauthorize' }, store, opts)
  assert.equal(out.status, 'completed')
  assert.deepEqual(store.disconnected, ['sa_ig', 'sa_wa'])
  assert.deepEqual(store.erased, [])
  assert.equal(store.notified.length, 0)
  assert.equal(describeDeletionStatus('completed', 'deauthorize').title, 'Desconectado · Disconnected')
})

test('a deauthorize retried at night never disconnects a line someone reconnected', async () => {
  const store = fakeStore({ '778': [lineA] })
  store.disconnectFails = 1
  await processMetaDataRequest({ metaUserId: '778', kind: 'deauthorize' }, store, opts)
  const row = [...store.rows.values()][0]!
  assert.equal(row.status, 'pending')
  store.rows.set(row.id, { ...row, updatedAt: new Date(0) })
  store.lines.set('sa_ig', { ...store.lines.get('sa_ig')!, isActive: true, metaUserId: '99999' }) // another admin reconnected
  await retryOpenDeletionRequests(store, async () => {}, { now: after(DAY / 2) })
  assert.deepEqual(store.disconnected, [])
  assert.equal(store.rows.get(row.id)!.status, 'completed')
})

test('before 058 is applied: lines are disconnected, nothing is erased, support is alerted', async () => {
  const store = fakeStore({ '888': [lineA] }, { sa_ig: ['chat-media/t1/m1'] })
  store.tableMissing = true
  const failures: string[] = []
  const out = await processMetaDataRequest({ metaUserId: '888', kind: 'deletion' }, store, { ...opts, onFailure: (s) => failures.push(s) })
  assert.equal(out.recorded, false)
  assert.deepEqual(store.disconnected, ['sa_ig'])
  assert.deepEqual(store.erased, [])
  assert.deepEqual(failures, ['not_recorded'])
  assert.match(describeDeletionStatus(null).body, /30 días/)
})

test('removeWithinBudget stops on time and hands back the rest', async () => {
  let t = 0
  const paths = Array.from({ length: STORAGE_BATCH * 3 }, (_, i) => `chat-media/t1/m${i}`)
  const out = await removeWithinBudget(paths, async () => {
    t += 600
  }, 1_000, () => t)
  assert.equal(out.errorCode, 'time_budget')
  assert.equal(out.remaining.length, STORAGE_BATCH)
})

test('signed_request: a bad signature is refused before any work', () => {
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '123' })).toString('base64url')
  const good = crypto.createHmac('sha256', 'app-secret').update(payload).digest('base64url')
  assert.ok(parseMetaSignedRequest(`${good}.${payload}`, ['app-secret']))
  assert.equal(parseMetaSignedRequest(`${good}.${payload}`, ['wrong']), null)
})

test('routes, store and status page are wired the safe way', () => {
  const front = read('src/lib/meta-data-deletion/callback.ts')
  assert.ok(front.indexOf('if (!isProductionContainer())') < front.indexOf('await readCapped(request'), 'production only, before reading')
  assert.doesNotMatch(front, /request.text()/, 'never reads an unbounded body')
  assert.ok(front.indexOf('Payload too large') < front.indexOf('parseMetaSignedRequest('))
  assert.ok(front.indexOf('parseMetaSignedRequest(signedRequest, secrets)') < front.indexOf('checkCallbackPayload(payload)'))
  for (const f of ['src/app/api/auth/instagram/data-deletion/route.ts', 'src/app/api/auth/meta/deauthorize/route.ts']) {
    const src = read(f)
    assert.ok(src.indexOf('readMetaCallback(') < src.indexOf('processMetaDataRequest('), `${f}: checks before any work`)
    assert.match(src, /if \(!callback\.ok\) return callback\.response/)
  }
  assert.match(read('src/app/api/auth/instagram/data-deletion/route.ts'), /kind: 'deletion'/)
  assert.match(read('src/app/api/auth/meta/deauthorize/route.ts'), /kind: 'deauthorize'/)
  assert.match(read('src/middleware.ts'), /'\/api\/auth\/meta\/deauthorize',/)
  const store = read('src/lib/meta-data-deletion/store.ts')
  assert.doesNotMatch(store, /prisma\.socialAccount\.delete(Many)?\(/, 'lines are disconnected, never deleted (agent setup stays)')
  assert.doesNotMatch(store, /"accountId" = \$\{metaUserId\}/, 'no legacy match on the Instagram account id')
  assert.match(store, /tx\.chatMessage\.deleteMany\(\{ where: \{ socialAccountId: line\.id, tenantId: line\.tenantId \} \}\)/)
  assert.match(store, /safeTenantChatPaths\(line\.tenantId/)
  assert.match(store, /role: 'OWNER', isActive: true/)
  const schema = read('prisma/schema.prisma')
  assert.doesNotMatch(schema, /metaUserId|MetaDataDeletionRequest/, '058 stays out of the Prisma models')
  const page = read('src/app/data-deletion/page.tsx')
  assert.match(page, /readDeletionStatus\(confirmationCode\)/)
  assert.doesNotMatch(page, /tenantId|accountIds|metaUserKey/, 'status page shows status and dates only')
  const cron = read('src/app/api/cron/workspace-retention/route.ts')
  assert.match(cron, /retryOpenDeletionRequests\(prismaDeletionStore, removeChatPaths/)
  assert.match(cron, /isProductionContainer\(\)\n?\s*\? await backfillMissingMetaUsers\(\)/)
  assert.match(read('src/app/api/auth/whatsapp/exchange/route.ts'), /backfillLineMetaUser\(saved\.id, await tokenGrantedByUserId\(businessToken\), \{ overwrite: true \}\)/)
  const sql = read('supabase/migrations/058_meta_data_deletion.sql')
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /DROP |DELETE |TRUNCATE /i)
})

test('privacy page states the real retention and processors', () => {
  const page = read('src/app/privacy/page.tsx')
  for (const needle of ['OpenAI', 'Supabase', 'Cloudflare', 'Upstash', 'Resend', 'Tilopay', 'Correos de Costa Rica', 'Telegram', 'Railway', 'Google']) {
    assert.ok(page.includes(needle), `sub-processor ${needle}`)
  }
  assert.match(page, /kept for 14 days/)
  assert.match(page, /'90 days, then deleted automatically\.'/)
  assert.match(page, /United States \(AWS us-east-1\)/)
  assert.match(page, /IGSID/)
  assert.match(page, /ctwa_clid/)
  assert.match(page, /within 30 days/)
  assert.match(page, /3 days/)
  assert.doesNotMatch(page, /within 24 hours/, 'old false promise is gone')
  assert.doesNotMatch(page, /new Date\(\)\.toLocaleDateString/, 'fixed date, not today’s date')
})

test('callback body reader stops at the cap even without Content-Length (chunked)', async () => {
  const { readCapped } = await import('../meta-data-deletion/callback')
  const stream = (n: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(1024).fill(97))
        c.close()
      },
    })
  const big = new Request('https://x.test/', { method: 'POST', body: stream(40), duplex: 'half' } as RequestInit)
  assert.equal(await readCapped(big, 16_384), null)
  const small = new Request('https://x.test/', { method: 'POST', body: 'signed_request=a.b' })
  assert.equal(await readCapped(small, 16_384), 'signed_request=a.b')
})
