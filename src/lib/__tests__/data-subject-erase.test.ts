import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  erasureConfirmToken,
  mediaPathsOf,
  openOrderNumbers,
  verifyErasureConfirmToken,
  type ErasureScope,
} from '../data-subject/erase'
import { customerLinkedWhere, customerMessageWhere, assertIds } from '../data-subject/records'

process.env.NEXTAUTH_SECRET ||= 'test-secret-for-erase'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const SRC = read('src/lib/data-subject/erase.ts')
const RECORDS = read('src/lib/data-subject/records.ts')
const ROUTE = read('src/app/api/clients/[id]/data-erase/route.ts')

/** Every Prisma call (prismaRaw.x / tx.x) with its argument text. */
function calls(src: string): Array<{ model: string; op: string; args: string }> {
  const out: Array<{ model: string; op: string; args: string }> = []
  const re = /\b(?:prisma|prismaRaw|tx)\.(\w+)\.(\w+)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') depth -= 1
      i += 1
    }
    out.push({ model: m[1], op: m[2], args: src.slice(re.lastIndex, i - 1) })
  }
  return out
}

test('every read and write in the erasure is scoped to the business explicitly', () => {
  const all = calls(SRC)
  assert.ok(all.length >= 15, `expected the full set, got ${all.length}`)
  for (const c of all) {
    assert.match(
      c.args,
      /where:\s*(\{[^}]*\btenantId\b|linkedWhere\b|messageWhere\b|customerLinkedWhere\(tenantId|customerMessageWhere\(tenantId)|data:\s*\{\s*tenantId,/,
      `${c.model}.${c.op} is missing an explicit tenantId`,
    )
  }
  // The shared filters always carry the business id and refuse empty ids.
  assert.deepEqual(customerLinkedWhere('t1', 'c1', ['v1']), { tenantId: 't1', OR: [{ clientId: 'c1' }, { conversationId: { in: ['v1'] } }] })
  assert.deepEqual(customerMessageWhere('t1', 'c1', []), { tenantId: 't1', OR: [{ clientId: 'c1', conversationId: null }] })
  assert.throws(() => customerLinkedWhere('t1', '', []), /DATA_SUBJECT_EMPTY_ID/)
  assert.throws(() => assertIds('t1', undefined), /DATA_SUBJECT_EMPTY_ID/)
  // Raw SQL in the record finder is business-scoped on every table.
  for (const t of ['"Order" o', '"ChatConversation" c', '"SocialAccount" s']) {
    const after = RECORDS.slice(RECORDS.indexOf(t))
    assert.match(after.slice(0, 200), /"tenantId" = \$\{tenantId\}/, t)
  }
})

test('messages are matched by chat, or by customer only when they are in no chat (DATA-23)', () => {
  const where = customerMessageWhere('t1', 'c1', ['v1', 'v2'])
  assert.deepEqual(where.OR, [{ conversationId: { in: ['v1', 'v2'] } }, { clientId: 'c1', conversationId: null }])
})

test('decisions are enforced: invoices, logistics and shipping labels are never touched', () => {
  const writes = calls(SRC).filter((c) => /update|delete|create|upsert/.test(c.op))
  const models = new Set(writes.map((c) => c.model))
  for (const kept of ['invoice', 'shippingGuia']) assert.equal(models.has(kept), false, `${kept} must not be written`)
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /lm_/)
  // Raw SQL only for the do-not-re-import list and the file outbox.
  for (const m of code.matchAll(/\$(?:executeRaw|queryRaw)(?:<[^>]+>)?`([\s\S]*?)`/g)) {
    assert.match(m[1]!, /"DataSubject(Suppression|MediaPurge)"/, m[1]!.slice(0, 80))
  }
  assert.deepEqual([...models].sort(), [
    'activityEvent',
    'auditLog',
    'chatConversation',
    'chatConversationWorkState',
    'chatMessage',
    'client',
    'clientIdentityConflict',
    'clientLifecycleState',
    'crmNote',
    'crmTask',
    'order',
    'workspaceNotification',
  ])
})

test('personal fields are blanked (incl. archived orders); chat-only notes/tasks go BEFORE the chats', () => {
  const client = calls(SRC).find((c) => c.model === 'client' && c.op === 'updateMany')!.args
  for (const f of ['name: ERASED_NAME', "phone: ''", 'email: null', 'normalizedPhone: null', 'normalizedEmail: null', 'address: null', 'notes: null', 'isActive: false']) {
    assert.ok(client.includes(f), `client ${f}`)
  }
  const order = calls(SRC).find((c) => c.model === 'order' && c.op === 'updateMany')!.args
  for (const f of ['customerName: ERASED_NAME', 'phone: null', 'email: null', 'address: null', 'comments: null', 'customFields: Prisma.DbNull', 'deleteReason: null', 'archiveMetadata: Prisma.DbNull']) {
    assert.ok(order.includes(f), `order ${f}`)
  }
  for (const kept of ['total', 'status', 'product', 'timestamp', 'province']) {
    assert.doesNotMatch(order, new RegExp(`\\b${kept}:`), `order ${kept} must be kept`)
  }
  // Archived orders are reachable: the raw client (no active-order filter) runs the transaction.
  assert.match(SRC, /prismaRaw\.\$transaction\(\s*async \(tx\)/)
  // DATA-16: notes / tasks / notifications / activity by chat id before the chats are deleted.
  const chatsGone = SRC.indexOf('tx.chatConversation.deleteMany')
  for (const before of ['tx.crmNote.deleteMany', 'tx.crmTask.deleteMany', 'tx.workspaceNotification.deleteMany', 'tx.activityEvent.deleteMany', 'tx.chatMessage.deleteMany']) {
    assert.ok(SRC.indexOf(before) > 0 && SRC.indexOf(before) < chatsGone, before)
  }
})

test('audit: lower-case entity types are redacted incl. reason, and the erasure audit is in the transaction', () => {
  assert.match(SRC, /entityType: \{ in: entityTypeFilterAliases\('client'\) \}/)
  assert.match(SRC, /entityType: \{ in: entityTypeFilterAliases\('order'\) \}/)
  assert.match(SRC, /data: \{ entityName: null, reason: null, oldValues: \{ redacted: 'ley8968' \}/)
  const txStart = SRC.indexOf('prismaRaw.$transaction(')
  const txEnd = SRC.indexOf('{ timeout: 30_000, maxWait: 10_000 }')
  const auditCreate = SRC.indexOf('tx.auditLog.create(')
  assert.ok(auditCreate > txStart && auditCreate < txEnd, 'audit record inside the transaction (DATA-24)')
  assert.doesNotMatch(ROUTE, /logAuditEvent/)
})

test('open orders: finished statuses (or a fallback list), touched in 60 days, not archived', () => {
  const now = Date.parse('2026-10-02T00:00:00Z')
  const day = 86_400_000
  const records = {
    orders: [
      { id: '1', orderId: 'A1', status: 'Pendiente', updatedAt: new Date(now - day), deletedAt: null, matchedBy: 'client' as const },
      { id: '2', orderId: 'A2', status: 'Entregado', updatedAt: new Date(now - day), deletedAt: null, matchedBy: 'client' as const },
      { id: '3', orderId: 'A3', status: 'Pendiente', updatedAt: new Date(now - 90 * day), deletedAt: null, matchedBy: 'client' as const },
      { id: '4', orderId: 'A4', status: 'Pendiente', updatedAt: new Date(now - day), deletedAt: new Date(), matchedBy: 'phone_or_email' as const },
    ],
  }
  assert.deepEqual(openOrderNumbers(records, new Set(['entregado']), now), ['A1'])
  assert.match(SRC, /if \(rows\.length === 0\) return new Set\(FALLBACK_TERMINAL/)
  assert.match(SRC, /o\.updatedAt\.getTime\(\) >= recent/, 'window uses the last update, not creation (DATA-19)')
})

test('chat files: column + legacy metadata paths, only inside this business folder; outbox retried', () => {
  const paths = mediaPathsOf(
    [
      { mediaBlobPath: 'chat-media/t1/a.jpg', metadata: null },
      { mediaBlobPath: null, metadata: { mediaBlobPath: 'chat-media/t1/legacy.ogg' } },
      { mediaBlobPath: 'chat-media/t2/other-business.jpg', metadata: null },
      { mediaBlobPath: 'chat-media/t1/../t2/x.jpg', metadata: null },
    ],
    't1',
  )
  assert.ok(paths.every((p) => !p.includes('..') && !p.includes('/t2/')))
  assert.match(SRC, /INSERT INTO public\."DataSubjectMediaPurge"/)
  assert.match(SRC, /export async function retryPendingMediaPurges/)
})

test('confirmation token is bound to the business, the exact data seen, the open orders and 10 minutes', () => {
  const scope: ErasureScope = {
    clientId: 'c1',
    orderIds: ['o1', 'o2'],
    conversationIds: ['v1'],
    counts: { orders: 2, ordersMatchedByContact: 1, archivedOrders: 0, conversations: 1, messages: 3, notes: 0, tasks: 0 },
    openOrders: [],
    phone: '88887777',
  }
  const now = 1_000_000
  const token = erasureConfirmToken('t1', scope, now)
  assert.equal(verifyErasureConfirmToken('t1', scope, token, now + 1000), true)
  assert.equal(verifyErasureConfirmToken('t2', scope, token, now), false, 'other business')
  assert.equal(verifyErasureConfirmToken('t1', { ...scope, orderIds: ['o1', 'o2', 'o3'] }, token, now), false, 'new order since preview')
  assert.equal(verifyErasureConfirmToken('t1', { ...scope, conversationIds: [] }, token, now), false, 'chat set changed')
  assert.equal(verifyErasureConfirmToken('t1', { ...scope, openOrders: ['A9'] }, token, now), false, 'an order became in progress')
  assert.equal(verifyErasureConfirmToken('t1', { ...scope, clientId: 'c2' }, token, now), false, 'other customer')
  assert.equal(verifyErasureConfirmToken('t1', scope, token, now + 10 * 60_000 + 1), false, 'expired')
  for (const bad of [null, '', 'x', `${now + 5000}.`, `${now + 5000}.AAAA`]) {
    assert.equal(verifyErasureConfirmToken('t1', scope, bad, now), false, String(bad))
  }
})

test('route: standby switch, owner only, works under billing restriction, needs 042, open orders need confirmation', () => {
  assert.ok(ROUTE.indexOf('dataSubjectRequestsEnabled()') < ROUTE.indexOf('authenticateAPIWithPermission('))
  assert.match(ROUTE, /authenticateAPIWithPermission\(request, 'manage_tenant', \{ skipBillingWriteGuard: true \}\)/)
  assert.match(ROUTE, /if \(!\(await erasureTablesReady\(\)\)\)/)
  assert.match(ROUTE, /prismaRaw\.client\.findFirst\(\{ where: \{ id, tenantId: auth\.tenantId \}/)
  assert.match(ROUTE, /resolveErasureScope\(auth\.tenantId, id\)/)
  assert.ok(ROUTE.indexOf('verifyErasureConfirmToken(') < ROUTE.indexOf('eraseCustomerData('))
  assert.ok(ROUTE.indexOf('body?.confirmFinished !== true') < ROUTE.indexOf('eraseCustomerData('))
  assert.ok(ROUTE.indexOf('sameName(body?.typedName') < ROUTE.indexOf('eraseCustomerData('))
  assert.match(ROUTE, /PII_NO_STORE_HEADERS/)
  assert.doesNotMatch(ROUTE, /error\.message/)
  const helpers = read('src/lib/auth-helpers.ts')
  assert.match(helpers, /return options\.skipBillingWriteGuard \? auth : applyBillingWriteGuard\(request, auth\);/)
})

test('WhatsApp history sync never rebuilds an erased customer chat; live messages unaffected (DATA-25)', () => {
  const webhook = read('src/app/api/chat/webhook/route.ts')
  assert.match(webhook, /if \(event\.metadata\?\.webhookField === 'history' && \(await isPhoneSuppressed\(account\.tenantId, event\.senderId\)\)\)/)
  const sup = read('src/lib/data-subject/suppression.ts')
  assert.match(sup, /createHmac\('sha256', hashKey\(\)\)/, 'stores a keyed hash, never the number')
  const sql = read('supabase/migrations/042_data_subject_requests.sql')
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE)\b/i)
  for (const t of ['DataSubjectSuppression', 'DataSubjectMediaPurge']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\."${t}" ENABLE ROW LEVEL SECURITY`))
  }
})
