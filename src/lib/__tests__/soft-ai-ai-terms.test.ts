import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_TERMS_CHECKBOX,
  AI_TERMS_POINTS,
  AI_TERMS_VERSION,
  isCurrentAiTerms,
} from '@/lib/soft-ai/ai-terms'
import {
  aiTermsAccepted,
  chatAgentLayerConfigToJson,
  parseChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-config'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const accepted = { version: AI_TERMS_VERSION, acceptedAt: '2026-10-02T00:00:00.000Z', acceptedByUserId: 'u1', acceptedByName: 'Rafael' }

describe('AI terms acceptance (business opt-in)', () => {
  it('is NOT accepted by default and only the current version counts', () => {
    assert.equal(aiTermsAccepted(parseChatAgentLayerConfig({})), false)
    assert.equal(aiTermsAccepted(parseChatAgentLayerConfig({ aiTerms: accepted })), true)
    assert.equal(aiTermsAccepted(parseChatAgentLayerConfig({ aiTerms: { ...accepted, version: 'ia-old' } })), false)
    assert.equal(isCurrentAiTerms(null), false)
  })

  it('malformed or partial records never count as accepted', () => {
    for (const bad of [null, 'yes', 1, {}, { version: AI_TERMS_VERSION }, { ...accepted, acceptedByUserId: '' }, { ...accepted, acceptedAt: '' }]) {
      assert.equal(aiTermsAccepted(parseChatAgentLayerConfig({ aiTerms: bad })), false)
    }
  })

  it('survives a config round trip (other writers cannot silently drop it)', () => {
    const cfg = parseChatAgentLayerConfig({ aiTerms: accepted })
    const again = parseChatAgentLayerConfig(chatAgentLayerConfigToJson(cfg))
    assert.deepEqual(again.aiTerms, accepted)
    assert.equal(chatAgentLayerConfigToJson(parseChatAgentLayerConfig({})).aiTerms, null)
  })

  it('the wording promises what the product does: no training, 30-day provider retention, own-data testing, revocable', () => {
    const text = AI_TERMS_POINTS.join(' ')
    assert.match(text, /no se usan para entrenar ni mejorar modelos de IA/i)
    assert.match(text, /30 días/)
    assert.match(text, /Probar\) usan solo mensajes que su equipo escribe/)
    assert.match(text, /revocar/i)
    assert.match(AI_TERMS_CHECKBOX, /Política de Privacidad/)
    assert.match(AI_TERMS_VERSION, /^ia-\d{4}-\d{2}-v\d+$/)
  })
})

describe('AI terms enforcement (static)', () => {
  it('customer messages never reach a provider before acceptance: gate runs before any budget read or model call', () => {
    const gates = read('src/lib/soft-ai/agent-claim-gates.ts')
    const pre = gates.slice(gates.indexOf('export async function runPreModelGates'), gates.indexOf('export async function runPreSendGates'))
    assert.match(pre, /aiTermsAccepted\(config\)/)
    assert.match(pre, /skipReason: 'ai_terms_not_accepted'/)
    assert.ok(pre.indexOf('aiTermsAccepted(config)') < pre.indexOf('loadDailyBilledTokens'))
    // agent-turn runs the pre-model gates before building any prompt
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.ok(turn.indexOf('runPreModelGates({') < turn.indexOf('runSoftAiLlmRuntime(runtimeInput)'))
  })

  it('the real-send approval is refused without it, and Probar (own simulated messages) is not blocked', () => {
    assert.match(read('src/lib/soft-ai/agent-unlock.ts'), /throw new AgentUnlockRefusal\('AI_TERMS_NOT_ACCEPTED'\)/)
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const probar = turn.slice(turn.indexOf('async function runAgentTestTurnInner'))
    assert.doesNotMatch(probar, /aiTermsAccepted|ai_terms_not_accepted/)
  })

  it('route: owners/admins only (update_config), version-bound, boolean, rate-limited, audited, tenant from session', () => {
    const src = read('src/app/api/chat/agents/ai-terms/route.ts')
    assert.match(src, /'update_config'/)
    assert.match(src, /typeof body\?\.accept !== 'boolean'/)
    assert.match(src, /body\.version !== AI_TERMS_VERSION/)
    assert.match(src, /createIdentifierRateLimit/)
    assert.match(src, /logAuditEvent/)
    assert.match(src, /mutateChatAgentLayerConfig\(auth\.tenantId/)
    assert.doesNotMatch(src, /searchParams\.get\('tenantId'\)/)
  })

  it('the card tells the truth about what is blocked and offers revocation', () => {
    const ui = read('src/app/config/agentes/AiTermsCard.tsx')
    assert.match(ui, /no responden ni sugieren/)
    assert.match(ui, /Revocar/)
    assert.match(ui, /Probar/)
    assert.match(read('src/app/config/agentes/page.tsx'), /<AiTermsCard canEdit=\{canEdit\} \/>/)
  })
})
