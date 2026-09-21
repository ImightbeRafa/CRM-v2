/**
 * AL2-A1 Probar sandbox (A1.9–A1.10, A1.13–A1.17).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectDryRunBlockers } from '../soft-ai/agent-claim-gates'
import { replayFixtures, REPLAY_FIXTURE_CAP } from '../soft-ai/agent-replay'
import { parseBrandFacts } from '../soft-ai/brand-facts'
import { buildAgentUserPrompt } from '../soft-ai/llm/prompt'
import { RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '../soft-ai/shortcuts'
import { runA1Tool } from '../soft-ai/llm/tool-runner'
import { FORGE_WA_V2_FIXTURES } from '../soft-ai/__fixtures__/forge-wa-v2'

const shortcuts: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((row, index) => ({
  ...row,
  isActive: true,
  sortOrder: index,
}))

const facts = parseBrandFacts({
  schemaVersion: 1,
  website: 'https://tienda.example',
  hoursText: 'Lun a sáb 9 a 6',
  shipping: {
    ea: { enabled: true, gamCost: 2100, outsideGamCost: 2850 },
    ra: { enabled: true, text: 'Retiro en tienda' },
  },
  payment: {
    shareWithCustomers: true,
    methods: ['sinpe'],
    sinpe: { number: '88881234', holderName: 'Tienda' },
  },
})

describe('Probar sandbox', () => {
  it('A1.13 history window keeps prior turns for the next prompt', () => {
    const history = [
      { id: '1', direction: 'inbound' as const, content: 'hola', sentAt: 't1' },
      { id: '2', direction: 'outbound' as const, content: 'hola', sentAt: 't2' },
      { id: '3', direction: 'inbound' as const, content: '¿cuánto cuesta el kit?', sentAt: 't3' },
      { id: '4', direction: 'outbound' as const, content: '₡27000', sentAt: 't4' },
    ]
    const prompt = buildAgentUserPrompt({ history, inboundText: 'para Heredia' })
    assert.match(prompt, /hola/)
    assert.match(prompt, /cuesta el kit/)
    assert.match(prompt, /para Heredia/)
    const turn = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.match(turn, /conversationId:\s*null/)
    assert.match(turn, /mode:\s*'test'/)
    assert.match(turn, /historyCount = history\.length/)
  })

  it('A1.15 sandbox order status does not require a live order row', async () => {
    const result = await runA1Tool(
      {
        tenantId: 'tenant-test',
        conversationId: '',
        socialAccountId: 'channel-x',
        peerId: 'peer',
        enabledTools: ['get_order_status'],
        sandbox: true,
      },
      'get_order_status',
      '{"orderNumberHint":"ORD-1"}',
    )
    assert.equal(result.ok, true)
    assert.equal(result.result.orderNumber, 'ORD-1')
    assert.equal(result.result.sandbox, true)
  })

  it('A1.16 replay stays inside the cap with zero policy violations when facts are shared', () => {
    assert.ok(FORGE_WA_V2_FIXTURES.length <= REPLAY_FIXTURE_CAP)
    const report = replayFixtures({
      brandFacts: facts,
      shortcuts,
      sharePaymentFacts: true,
    })
    assert.equal(report.fixtureSetHash, 'forge-wa-v2-al2-a1-2026-09-21')
    assert.equal(report.policyViolations, 0)
    assert.equal(report.capped, false)
    assert.equal(report.passRate, 1)
    const info = report.rows.filter((row) => row.tag === 'payment_info')
    assert.ok(info.length > 0)
    assert.ok(info.every((row) => row.actualHandoff === false))
    const proof = report.rows.filter((row) => row.tag === 'payment_proof')
    assert.ok(proof.every((row) => row.actualHandoff === true))
  })

  it('A1.17 closed window and locked ai_full block a dry-run send', () => {
    const blocked = collectDryRunBlockers({
      layerEnabled: true,
      softEnabled: true,
      allowlisted: true,
      operationMode: 'ai_full',
      unlockedForSend: false,
      windowOpen: false,
      agentStatus: 'live',
    })
    assert.deepEqual(blocked, ['ai_full_not_unlocked', 'window_closed'])
  })

  it('A1.9–A1.10 channel writes audit the binding and drop unlock when IA is off', () => {
    const admin = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-admin.ts'), 'utf8')
    assert.match(admin, /reason: 'chat_agent_channel_allowlist'/)
    assert.match(admin, /delete aiFullUnlock\[input\.socialAccountId\]/)
    assert.match(admin, /await setAgentBinding\(/)
  })
})
