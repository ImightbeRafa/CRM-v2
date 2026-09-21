/**
 * AL2-A1 brand facts (A1.12, A1.18).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canSharePaymentFacts,
  maskConfiguredPaymentSecrets,
  parseBrandFacts,
} from '../soft-ai/brand-facts'
import { isAccountAllowlisted, parseChatAgentLayerConfig } from '../soft-ai/agent-config'
import { FIXTURE_SOCIAL_ACCOUNT_ID } from '../soft-ai/__fixtures__/forge-wa-v2'

describe('brand facts', () => {
  it('A1.18 configured SINPE numbers are masked in traces', () => {
    const facts = parseBrandFacts({
      schemaVersion: 1,
      payment: {
        shareWithCustomers: true,
        methods: ['sinpe'],
        sinpe: { number: '88881234' },
      },
    })
    assert.equal(canSharePaymentFacts(facts), true)
    const masked = maskConfiguredPaymentSecrets('Pagá al SINPE 88881234 hoy', facts)
    assert.match(masked, /SINPE \*\*\*\*1234/)
    assert.doesNotMatch(masked, /88881234/)
  })

  it('A1.12 an empty allowlist matches nobody and auto-activate has no fixed account', () => {
    const config = parseChatAgentLayerConfig({ accountAllowlist: [] })
    assert.deepEqual(config.accountAllowlist, [])
    assert.equal(isAccountAllowlisted(config, FIXTURE_SOCIAL_ACCOUNT_ID), false)
    assert.equal(isAccountAllowlisted(config, 'any-other-account'), false)
    const missing = parseChatAgentLayerConfig({})
    assert.deepEqual(missing.accountAllowlist, [])
    const writer = readFileSync(join(process.cwd(), 'src/lib/chat-conversation-write.ts'), 'utf8')
    assert.match(writer, /accountAllowlist\.includes\(args\.socialAccountId\)/)
    assert.doesNotMatch(writer, /cmuahn5y90001l504y6kksiek/)
    assert.doesNotMatch(writer, /Forge/)
  })
})
