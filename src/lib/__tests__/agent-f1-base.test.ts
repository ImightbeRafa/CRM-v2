import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('F1 · shipping status finds the guía ("¿dónde viene mi pedido?")', () => {
  const src = read('src/lib/soft-ai/llm/tool-runner.ts')
  const shipping = src.slice(src.indexOf('async function runGetShippingStatus'), src.indexOf('async function runEscalate'))

  it('looks the guía up by the order NUMBER, which is what every guía writer stores', () => {
    assert.match(shipping, /orderId: order\.orderId/)
    assert.doesNotMatch(shipping, /orderId: order\.id\b/)
    // guía-only lookups resolve the guía's order by number too
    assert.match(shipping, /where: \{ orderId: row\.orderId, tenantId: ctx\.tenantId \}/)
    // writers really store the number (production guía service + logistics bulk)
    assert.match(read('src/lib/bot/guia-service.ts'), /shippingGuia[\s\S]{0,400}orderId: order\.orderId/)
  })

  it('orders a human linked to this chat count as owned (tenant + conversation scoped)', () => {
    assert.match(src, /async function linkedOrderIds/)
    assert.match(
      src,
      /chatMessage\.findMany\(\{\s*where: \{ tenantId: ctx\.tenantId, conversationId: ctx\.conversationId, orderId: \{ not: null \} \}/,
    )
    assert.match(src, /linked\.has\(order\.id\) \|\| \(await ownershipOk\(ctx, order\)\)/)
  })

  it('a guía-only lookup still needs ownership (no probing other customers’ guías)', () => {
    assert.match(shipping, /!guiaOrder \|\| !\(linked\.has\(guiaOrder\.id\) \|\| \(await ownershipOk\(ctx, guiaOrder\)\)\)/)
  })

  it('live Correos tracking is best-effort and time-capped', () => {
    assert.match(src, /async function correosTrackingEvents/)
    assert.match(src, /resolveCorreosWSCredentials/)
    assert.match(src, /setTimeout\(\(\) => resolve\(null\), 5000\)/)
    assert.match(src, /\^\[A-Za-z0-9-\]\{4,30\}\$/)
    assert.match(shipping, /lastEvents: tracking\?\.lastEvents \?\? \[\]/)
  })
})
