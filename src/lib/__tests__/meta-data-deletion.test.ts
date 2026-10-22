import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import {
  MAX_RETRY_ATTEMPTS,
  STORAGE_BATCH,
  describeDeletionStatus,
  isConfirmationCode,
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
const read = (p: string) => readFileSync(p, 'utf8')

type Fake = DeletionStore & {
  rows: Map<string, DeletionRequestRow & { metaUserKey: string }>
  erased: string[]
  disconnected: string[]
  tableMissing: boolean
  eraseFails: number
}

function fakeStore(lines: Record<string, MetaLineRef[]>, paths: Record<string, string[]> = {}): Fake {
  const all = Object.values(lines).flat()
  const store: Fake = {
    rows: new Map(),
    erased: [],
    disconnected: [],
    tableMissing: false,
    eraseFails: 0,
    async findLines(id) {
      return lines[id] ?? []
    },
    async findLinesByIds(ids) {
      return all.filter((l) => ids.includes(l.id))
    },
    async collectPaths(line) {
      return paths[line.id] ?? []
    },
    async eraseLine(line) {
      if (store.eraseFails > 0) {
        store.eraseFails -= 1
        throw Object.assign(new Error('db down'), { code: 'P1001' })
      }
      store.erased.push(line.id)
    },
    async disconnectLine(line) {
      store.disconnected.push(line.id)
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

test('confirmation codes and the HMAC user key (never the raw id, needs the secret)', () => {
  const key = metaUserKey('1234567890', SECRET)
  assert.match(key, /^[a-f0-9]{64}$/)
  assert.notEqual(key, crypto.createHash('sha256').update('1234567890').digest('hex'))
  assert.notEqual(key, metaUserKey('1234567890', 'other'))
  assert.throws(() => metaUserKey('1', ''), /NEXTAUTH_SECRET/)
  assert.ok(isConfirmationCode('BETSY-DEL-0123456789AB'))
  assert.ok(!isConfirmationCode('BETSY-DEL-0123'))
  assert.ok(!isConfirmationCode("BETSY-DEL-0123456789AB' OR 1=1"))
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

test('deletion: erases each line, removes its files, records completed', async () => {
  const store = fakeStore({ '111': [lineA, lineB] }, { sa_ig: ['chat-media/t1/m1'], sa_wa: ['chat-media/t1/m2', 'chat-media/t1/m1'] })
  const removed: string[][] = []
  const out = await processMetaDataRequest({ metaUserId: '111', kind: 'deletion' }, store, async (p) => void removed.push(p), { secret: SECRET })
  assert.equal(out.status, 'completed')
  assert.equal(out.matchedAccounts, 2)
  assert.ok(isConfirmationCode(out.confirmationCode))
  assert.deepEqual(store.erased, ['sa_ig', 'sa_wa'])
  assert.deepEqual(store.disconnected, [])
  assert.deepEqual(removed.flat(), ['chat-media/t1/m1', 'chat-media/t1/m2'])
  const row = [...store.rows.values()][0]!
  assert.equal(row.status, 'completed')
  assert.ok(row.completedAt)
  assert.ok(!JSON.stringify(row).includes('"111"'), 'raw Meta id never stored')
})

test('deletion with no matching line answers no_data (and still a code for Meta)', async () => {
  const store = fakeStore({})
  const out = await processMetaDataRequest({ metaUserId: '222', kind: 'deletion' }, store, async () => {}, { secret: SECRET })
  assert.equal(out.status, 'no_data')
  assert.equal([...store.rows.values()][0]!.status, 'no_data')
})

test('a storage failure is not swallowed: pending_storage with the remaining paths, then the cron finishes it', async () => {
  const paths = Array.from({ length: STORAGE_BATCH + 5 }, (_, i) => `chat-media/t1/m${i}`)
  const store = fakeStore({ '333': [lineA] }, { sa_ig: paths })
  const failures: string[] = []
  let calls = 0
  const out = await processMetaDataRequest(
    { metaUserId: '333', kind: 'deletion' },
    store,
    async () => {
      calls += 1
      if (calls === 2) throw Object.assign(new Error('storage 503'), { name: 'ChatStorageError' })
    },
    { secret: SECRET, onFailure: (stage, code) => failures.push(`${stage}:${code}`) },
  )
  assert.equal(out.status, 'pending_storage')
  assert.deepEqual(failures, ['storage:ChatStorageError'])
  const row = [...store.rows.values()][0]!
  assert.equal(row.pendingPaths.length, 5)
  assert.equal(row.lastErrorCode, 'ChatStorageError')
  assert.deepEqual(store.erased, ['sa_ig'], 'the database part is already done')

  // The cron only picks rows not touched in the last 5 minutes.
  const later = () => new Date(Date.now() + 10 * 60 * 1000)
  const removed: string[] = []
  const res = await retryOpenDeletionRequests(store, async (p) => void removed.push(...p), { now: later })
  assert.deepEqual(res, { checked: 1, completed: 1, stillPending: 0, failed: 0 })
  assert.equal(removed.length, 5)
  assert.equal(store.rows.get(row.id)!.status, 'completed')
  assert.deepEqual(store.rows.get(row.id)!.pendingPaths, [])
})

test('a database failure leaves the request pending; the cron re-runs the erase', async () => {
  const store = fakeStore({ '444': [lineA] }, { sa_ig: ['chat-media/t1/m1'] })
  store.eraseFails = 1
  const failures: string[] = []
  const out = await processMetaDataRequest({ metaUserId: '444', kind: 'deletion' }, store, async () => {}, {
    secret: SECRET,
    onFailure: (stage, code) => failures.push(`${stage}:${code}`),
  })
  assert.equal(out.status, 'pending')
  assert.deepEqual(failures, ['erase:P1001'])
  const res = await retryOpenDeletionRequests(store, async () => {}, { now: () => new Date(Date.now() + 600_000) })
  assert.equal(res.completed, 1)
  assert.deepEqual(store.erased, ['sa_ig'])
})

test('a failure half-way keeps the file paths already found (the retry deletes them, not "completed" with files left)', async () => {
  const store = fakeStore({ '4441': [lineA, lineB] }, { sa_ig: ['chat-media/t1/ig1'], sa_wa: ['chat-media/t1/wa1'] })
  const realErase = store.eraseLine
  let n = 0
  store.eraseLine = async (line) => {
    n += 1
    if (n === 2) throw Object.assign(new Error('db blip'), { code: 'P1001' })
    return realErase(line)
  }
  const out = await processMetaDataRequest({ metaUserId: '4441', kind: 'deletion' }, store, async () => {}, { secret: SECRET })
  assert.equal(out.status, 'pending')
  const row = [...store.rows.values()][0]!
  assert.deepEqual(row.pendingPaths.sort(), ['chat-media/t1/ig1', 'chat-media/t1/wa1'])
  // Night: line A's messages are gone (collectPaths finds nothing for it), yet its file is still removed.
  store.eraseLine = realErase
  const removed: string[] = []
  const later = { now: () => new Date(Date.now() + 600_000) }
  const fresh = fakeStore({}, {})
  store.collectPaths = fresh.collectPaths
  await retryOpenDeletionRequests(store, async (p) => void removed.push(...p), later)
  assert.deepEqual(removed.sort(), ['chat-media/t1/ig1', 'chat-media/t1/wa1'])
  assert.equal(store.rows.get(row.id)!.status, 'completed')
})

test('the nightly retry never touches a line reconnected after the request', async () => {
  const reconnected: MetaLineRef = { ...lineA, linkedAt: new Date(Date.now() + 60_000) }
  const store = fakeStore({ '4442': [lineA] })
  store.findLinesByIds = async () => [reconnected]
  store.eraseFails = 1
  await processMetaDataRequest({ metaUserId: '4442', kind: 'deauthorize' }, store, async () => {}, { secret: SECRET })
  store.disconnectLine = async () => {
    throw new Error('first disconnect fails')
  }
  const row = [...store.rows.values()][0]!
  store.rows.set(row.id, { ...row, status: 'pending', updatedAt: new Date(0) })
  const touched: string[] = []
  store.disconnectLine = async (l) => void touched.push(l.id)
  store.eraseLine = async (l) => void touched.push(l.id)
  await retryOpenDeletionRequests(store, async () => {})
  assert.deepEqual(touched, [])
})

test('after MAX attempts the request is marked failed and reported (status page says manual review)', async () => {
  const store = fakeStore({ '555': [lineA] }, { sa_ig: ['chat-media/t1/m1'] })
  const failures: string[] = []
  await processMetaDataRequest({ metaUserId: '555', kind: 'deletion' }, store, async () => {
    throw new Error('down')
  }, { secret: SECRET })
  const row = [...store.rows.values()][0]!
  store.rows.set(row.id, { ...row, attempts: MAX_RETRY_ATTEMPTS - 1, updatedAt: new Date(0) })
  const res = await retryOpenDeletionRequests(store, async () => {
    throw new Error('still down')
  }, { onFailure: (stage) => failures.push(stage) })
  assert.equal(res.failed, 1)
  assert.equal(store.rows.get(row.id)!.status, 'failed')
  assert.ok(failures.includes('gave_up'))
  assert.match(describeDeletionStatus('failed').body, /support@betsycrm\.com/)
})

test('Meta resending the same request within minutes gets the same code (no second erase)', async () => {
  const store = fakeStore({ '666': [lineA] })
  const first = await processMetaDataRequest({ metaUserId: '666', kind: 'deletion' }, store, async () => {}, { secret: SECRET })
  const again = await processMetaDataRequest({ metaUserId: '666', kind: 'deletion' }, store, async () => {}, { secret: SECRET })
  assert.equal(again.confirmationCode, first.confirmationCode)
  assert.ok(again.reused)
  assert.equal(store.rows.size, 1)
  assert.deepEqual(store.erased, ['sa_ig'])
})

test('deauthorize only disconnects (history kept), never erases', async () => {
  const store = fakeStore({ '777': [lineA, lineB] }, { sa_ig: ['chat-media/t1/m1'] })
  const removed: string[] = []
  const out = await processMetaDataRequest({ metaUserId: '777', kind: 'deauthorize' }, store, async (p) => void removed.push(...p), {
    secret: SECRET,
  })
  assert.equal(out.status, 'completed')
  assert.deepEqual(store.disconnected, ['sa_ig', 'sa_wa'])
  assert.deepEqual(store.erased, [])
  assert.deepEqual(removed, [])
})

test('before 058 is applied: the work is still done, nothing recorded', async () => {
  const store = fakeStore({ '888': [lineA] }, { sa_ig: ['chat-media/t1/m1'] })
  store.tableMissing = true
  const removed: string[] = []
  const out = await processMetaDataRequest({ metaUserId: '888', kind: 'deletion' }, store, async (p) => void removed.push(...p), {
    secret: SECRET,
  })
  assert.equal(out.recorded, false)
  assert.equal(out.status, 'completed')
  assert.deepEqual(store.erased, ['sa_ig'])
  assert.deepEqual(removed, ['chat-media/t1/m1'])
  assert.equal(describeDeletionStatus(null).title, 'Solicitud recibida · Request received')
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
  const del = read('src/app/api/auth/instagram/data-deletion/route.ts')
  const deauth = read('src/app/api/auth/meta/deauthorize/route.ts')
  for (const src of [del, deauth]) {
    assert.match(src, /parseMetaSignedRequest\(signedRequest, secrets\)/)
    assert.ok(src.indexOf("status: 403") < src.indexOf('processMetaDataRequest('), 'signature checked before any work')
    assert.doesNotMatch(src, /\.catch\(\(\) => \{\s*\}\)/)
  }
  assert.match(del, /kind: 'deletion'/)
  assert.match(deauth, /kind: 'deauthorize'/)
  const mw = read('src/middleware.ts')
  assert.match(mw, /'\/api\/auth\/meta\/deauthorize',/)
  const store = read('src/lib/meta-data-deletion/store.ts')
  assert.doesNotMatch(store, /prisma\.socialAccount\.delete(Many)?\(/, 'lines are disconnected, never deleted (agent setup stays)')
  assert.match(store, /tx\.chatMessage\.deleteMany\(\{ where: \{ socialAccountId: line\.id, tenantId: line\.tenantId \} \}\)/)
  assert.match(store, /safeTenantChatPaths\(line\.tenantId/)
  // 058 stays out of the Prisma models so code before the SQL keeps working.
  const schema = read('prisma/schema.prisma')
  assert.doesNotMatch(schema, /metaUserId|MetaDataDeletionRequest/)
  const page = read('src/app/data-deletion/page.tsx')
  assert.match(page, /readDeletionStatus\(confirmationCode\)/)
  assert.doesNotMatch(page, /tenantId|accountIds|metaUserKey/, 'status page shows status and dates only')
  const cron = read('src/app/api/cron/workspace-retention/route.ts')
  assert.match(cron, /retryOpenDeletionRequests\(prismaDeletionStore, removeChatPaths/)
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
  assert.doesNotMatch(page, /within 24 hours/, 'old false promise is gone')
  assert.doesNotMatch(page, /new Date\(\)\.toLocaleDateString/, 'fixed date, not today’s date')
})
