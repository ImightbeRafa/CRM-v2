import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { erasureConfirmToken, verifyErasureConfirmToken, type ErasureScope } from '../data-subject/erase'

process.env.NEXTAUTH_SECRET ||= 'test-secret-for-erase'

const SRC = readFileSync('src/lib/data-subject/erase.ts', 'utf8')
const ROUTE = readFileSync('src/app/api/clients/[id]/data-erase/route.ts', 'utf8')

/** Every Prisma call (prisma.x / tx.x) with its argument text. */
function calls(src: string): Array<{ model: string; op: string; args: string }> {
  const out: Array<{ model: string; op: string; args: string }> = []
  const re = /\b(?:prisma|tx)\.(\w+)\.(\w+)\(/g
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
    assert.match(c.args, /where:\s*\{[^}]*\btenantId\b/, `${c.model}.${c.op} is missing an explicit tenantId`)
  }
})

test('decisions are enforced: invoices, logistics and shipping labels are never touched', () => {
  const models = new Set(calls(SRC).filter((c) => /update|delete|create|upsert/.test(c.op)).map((c) => c.model))
  for (const kept of ['invoice', 'shippingGuia']) assert.equal(models.has(kept), false, `${kept} must not be written`)
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /lm_|\$executeRaw|\$queryRaw/)
  // Only these models are changed.
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
  ])
})

test('personal fields are blanked on the customer and orders; amounts and status stay', () => {
  const client = calls(SRC).find((c) => c.model === 'client' && c.op === 'updateMany')!.args
  for (const f of ['name: ERASED_NAME', "phone: ''", 'email: null', 'normalizedPhone: null', 'normalizedEmail: null', 'address: null', 'notes: null', 'isActive: false']) {
    assert.ok(client.includes(f), `client ${f}`)
  }
  const order = calls(SRC).find((c) => c.model === 'order' && c.op === 'updateMany')!.args
  for (const f of ['customerName: ERASED_NAME', 'phone: null', 'email: null', 'address: null', 'comments: null', 'customFields: Prisma.DbNull']) {
    assert.ok(order.includes(f), `order ${f}`)
  }
  for (const kept of ['total', 'status', 'product', 'timestamp', 'province']) {
    assert.doesNotMatch(order, new RegExp(`\\b${kept}:`), `order ${kept} must be kept`)
  }
  // Messages deleted explicitly (their chat link is SET NULL, not cascade), before the chats.
  assert.ok(SRC.indexOf('tx.chatMessage.deleteMany') < SRC.indexOf('tx.chatConversation.deleteMany'))
  // One transaction; chat files only from this business's own folder, after commit.
  assert.match(SRC, /prisma\.\$transaction\(\s*async \(tx\)/)
  assert.match(SRC, /p\.startsWith\(mediaPrefix\) && !p\.includes\('\.\.'\)/)
  assert.ok(SRC.indexOf('deleteChatBlobs(batch)') > SRC.indexOf('prisma.$transaction('))
})

test('confirmation token is bound to the business, the exact data seen, and 10 minutes', () => {
  const scope: ErasureScope = {
    clientId: 'c1',
    orderIds: ['o1', 'o2'],
    conversationIds: ['v1'],
    counts: { orders: 2, conversations: 1, messages: 3, notes: 0, tasks: 0 },
    openOrders: [],
  }
  const now = 1_000_000
  const token = erasureConfirmToken('t1', scope, now)
  assert.equal(verifyErasureConfirmToken('t1', scope, token, now + 1000), true)
  assert.equal(verifyErasureConfirmToken('t2', scope, token, now), false, 'other business')
  assert.equal(verifyErasureConfirmToken('t1', { ...scope, orderIds: ['o1', 'o2', 'o3'] }, token, now), false, 'new order since preview')
  assert.equal(verifyErasureConfirmToken('t1', { ...scope, conversationIds: [] }, token, now), false, 'chat set changed')
  assert.equal(verifyErasureConfirmToken('t1', { ...scope, clientId: 'c2' }, token, now), false, 'other customer')
  assert.equal(verifyErasureConfirmToken('t1', scope, token, now + 10 * 60_000 + 1), false, 'expired')
  for (const bad of [null, '', 'x', `${now + 5000}.`, `${now + 5000}.AAAA`]) {
    assert.equal(verifyErasureConfirmToken('t1', scope, bad, now), false, String(bad))
  }
})

test('route: owner only, open orders block, token + typed name required, audited with counts only', () => {
  assert.match(ROUTE, /authenticateAPIWithPermission\(request, 'manage_tenant'\)/)
  assert.match(ROUTE, /prisma\.client\.findFirst\(\{ where: \{ id, tenantId: auth\.tenantId \}/)
  assert.match(ROUTE, /resolveErasureScope\(auth\.tenantId, id\)/)
  assert.ok(ROUTE.indexOf('scope.openOrders.length') < ROUTE.indexOf('eraseCustomerData('))
  assert.ok(ROUTE.indexOf('verifyErasureConfirmToken(') < ROUTE.indexOf('eraseCustomerData('))
  assert.ok(ROUTE.indexOf('sameName(body?.typedName') < ROUTE.indexOf('eraseCustomerData('))
  assert.match(ROUTE, /confirmToken: scope\.openOrders\.length \? null : erasureConfirmToken/)
  assert.match(ROUTE, /newValues: \{ counts: result\.counts/)
  assert.match(ROUTE, /PII_NO_STORE_HEADERS/)
  assert.doesNotMatch(ROUTE, /error\.message/)
  // Open-order rule uses the business's own finished statuses, recent orders only.
  assert.match(SRC, /tenantOrderStatusClassification\.findMany\(\{\s*where: \{ tenantId, isTerminal: true \}/)
  assert.match(SRC, /OPEN_ORDER_WINDOW_DAYS = 60/)
})
