import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('F1 · order ownership is one shared rule', () => {
  const own = read('src/lib/soft-ai/order-ownership.ts')

  it('orders a human linked to this chat count as owned (tenant + conversation scoped)', () => {
    assert.match(own, /export async function linkedOrderIds/)
    assert.match(own, /chatMessage\.findMany\(\{\s*where: \{ tenantId, conversationId, orderId: \{ not: null \} \}/)
    assert.match(own, /if \(links\.has\(order\.id\)\) return true/)
  })

  it('phone ownership keeps the last-8-digit rule and the verified-client check', () => {
    assert.match(own, /phoneOwnershipMatch\(hints/)
    assert.match(own, /client\.findFirst\(\{\s*where: \{ id: ctx\.clientId, tenantId: ctx\.tenantId \}/)
  })

  it('soft-deleted orders stay hidden: ownership reads go through the activeOrderReads client', () => {
    assert.match(own, /import \{ prisma \} from '@\/lib\/db'/)
    assert.match(read('src/lib/db.ts'), /name: 'activeOrderReads'/)
  })

  it('guías are found by order NUMBER and failed attempts are skipped', () => {
    const guia = own.slice(own.indexOf('export async function latestGuiaForOrderNumber'))
    assert.match(guia, /orderId: orderNumber/)
    assert.match(guia, /status: \{ not: 'failed' \}/)
    assert.match(guia, /OR: \[\{ guiaNumber: \{ not: null \} \}, \{ trackingNumber: \{ not: null \} \}\]/)
    // writers really store the number
    assert.match(read('src/lib/bot/guia-service.ts'), /shippingGuia[\s\S]{0,400}orderId: order\.orderId/)
  })
})

describe('F1 · "¿dónde viene mi pedido?" (layer tool)', () => {
  const src = read('src/lib/soft-ai/llm/tool-runner.ts')
  const shipping = src.slice(src.indexOf('async function runGetShippingStatus'), src.indexOf('async function runEscalate'))

  it('uses the shared ownership rule and the order-number guía lookup', () => {
    assert.match(src, /from '@\/lib\/soft-ai\/order-ownership'/)
    assert.match(shipping, /latestGuiaForOrderNumber\(ctx\.tenantId, order\.orderId\)/)
    assert.doesNotMatch(shipping, /orderId: order\.id\b/)
  })

  it('a guía-only lookup still needs ownership (no probing other customers’ guías)', () => {
    assert.match(shipping, /where: \{ orderId: row\.orderId, tenantId: ctx\.tenantId \}/)
    assert.match(shipping, /!guiaOrder \|\| !\(await isOrderOwned\(ownershipCtx\(ctx\), guiaOrder\)\)/)
  })

  it('live Correos tracking is best-effort and time-capped', () => {
    assert.match(src, /async function correosTrackingEvents/)
    assert.match(src, /resolveCorreosWSCredentials/)
    assert.match(src, /setTimeout\(\(\) => resolve\(null\), 5000\)/)
    assert.match(src, /\^\[A-Za-z0-9-\]\{4,30\}\$/)
    assert.match(shipping, /lastEvents: tracking\?\.lastEvents \?\? \[\]/)
  })
})

describe('F1 · legacy v1 deps no longer leak other customers’ orders', () => {
  const deps = read('src/lib/soft-ai/server-deps.ts')

  it('customer turns are scoped to the chat peer; only the staff route may look up any order', () => {
    assert.match(deps, /\| \{ tenantId: string; peerId: string; conversationId\?: string \| null \}/)
    assert.match(deps, /\| \{ tenantId: string; staff: true \}/)
    assert.match(deps, /if \(owner && !\(await isOrderOwned\(owner, row\)\)\) return null/)
    assert.match(deps, /const owned = await findOwnedOrder\(owner, orderNumberHint\)/)
    assert.match(deps, /latestGuiaForOrderNumber\(tenantId, order\.orderId\)/)
  })

  it('the inbound hook passes the peer; the staff run route (update_sales) passes staff', () => {
    assert.match(read('src/lib/soft-ai/inbound-hook.ts'), /buildSoftAiServerDeps\(\{\s*tenantId: args\.tenantId,\s*peerId: args\.senderId,/)
    const run = read('src/app/api/chat/soft-ai/run/route.ts')
    assert.match(run, /buildSoftAiServerDeps\(\{ tenantId, staff: true \}\)/)
    assert.match(run, /update_sales/)
  })
})
