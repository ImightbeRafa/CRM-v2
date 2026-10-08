/**
 * Production guía service (src/lib/shipping) vs the staff bot's copy (src/lib/bot, untouched by rule).
 * Both register guías with Correos; they must claim the SAME key in the same table so the two copies can never
 * register two guías for one order (double click in /produccion while the bot also runs, etc.).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const prod = readFileSync('src/lib/shipping/guia-service.ts', 'utf8')
const bot = readFileSync('src/lib/bot/guia-service.ts', 'utf8')

describe('guía service parity (production copy vs staff bot copy)', () => {
  it('same external claim key and adapter', () => {
    for (const src of [prod, bot]) {
      assert.match(src, /externalClaimKey = `correos-guia:\$\{order\.id\}`/)
      assert.match(src, /const CORREOS_PROVIDER_ADAPTER = 'correos-provider'/)
      assert.match(src, /operation: 'correos_guia_external_claim'/)
    }
  })

  it('tenant code uses the production copy, never the bot folder', () => {
    for (const f of ['src/app/api/shipping/generate-guia/route.ts', 'src/app/api/integration/guia/generate/route.ts']) {
      const src = readFileSync(f, 'utf8')
      assert.match(src, /from '@\/lib\/shipping\/guia-service'/)
      assert.doesNotMatch(src, /@\/lib\/bot\//)
    }
  })

  it('automatic guías can refuse the 10101 fallback when the postal code is unknown', () => {
    assert.match(prod, /requireResolvedPostalCode\?: boolean/)
    assert.match(prod, /if \(options\.requireResolvedPostalCode && !destZipResolved\) \{/)
  })
})
