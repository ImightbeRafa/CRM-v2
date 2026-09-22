/**
 * P3 audited unlock (AT-P-3, AT-P-4).
 * Qualification is dependency-injected. The flag lock is an in-memory FOR UPDATE.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  aiFullUnlockStatus,
  chatAgentLayerConfigToJson,
  channelRealSendStatus,
  formatRealSendStatus,
  formatUnlockConfirm,
  formatUnlockSuccessLine,
  hasAiFullUnlock,
  parseChatAgentLayerConfig,
  realSendFromUnlockStatus,
  withoutAccountUnlock,
} from '../soft-ai/agent-config'
import {
  mutateChatAgentLayerConfig,
  type ChatAgentLayerFlagDb,
} from '../soft-ai/agent-layer-config-mutate'
import {
  assessUnlockCanaryTurn,
  expectedReplayHandoff,
  replayAccountBinding,
} from '../soft-ai/agent-replay'
import { shouldClearAccountUnlock } from '../soft-ai/agent-admin'
import {
  agentUnlockHttpError,
  approveAgentAiFullUnlock,
  isAgentUnlockRefusal,
  type AgentUnlockDeps,
} from '../soft-ai/agent-unlock'
import { composeEffectiveBehavior } from '../soft-ai/agent-resolver'
import {
  AI_FULL_UNLOCK_REFUSAL_CODES,
  DEFAULT_CHAT_AGENT_LAYER_CONFIG,
  FORGE_WA_V2_FIXTURE_SET_HASH,
  type AiFullUnlockRefusalCode,
  type ChatAgentLayerConfig,
} from '../soft-ai/agent-types'
import { FORGE_WA_V2_FIXTURES, type ReplayFixtureV2 } from '../soft-ai/__fixtures__/forge-wa-v2'

const HASH = FORGE_WA_V2_FIXTURE_SET_HASH
const ACCOUNT = 'acct-wa-1'
const AGENT_ID = 'agent-ventas'

const CTX = { agentId: AGENT_ID, model: 'grok-4.7', agentVersion: 3 }

function record(partial: Record<string, unknown> = {}) {
  return {
    passedAt: '2026-09-22T12:00:00.000Z',
    approvedBy: 'user-1',
    fixtureSetHash: HASH,
    passRate: 1,
    agentId: AGENT_ID,
    agentVersion: 3,
    model: 'grok-4.7',
    canaryCount: 5,
    ...partial,
  }
}

function config(partial: Record<string, unknown> = {}): ChatAgentLayerConfig {
  return parseChatAgentLayerConfig({
    accountAllowlist: [ACCOUNT],
    fixtureSetHash: HASH,
    strictUnlockVersion: false,
    unlockCanaries: true,
    testDailyTokenCap: 1_000,
    aiFullUnlock: {},
    ...partial,
  })
}

const agent = {
  id: AGENT_ID,
  name: 'Ventas',
  status: 'live',
  model: 'grok-4.7',
  version: 3,
  brandFacts: {},
  replyStyle: {},
}

function serving(partial: Record<string, unknown> = {}) {
  return {
    agentId: AGENT_ID,
    scope: 'social_account' as const,
    status: 'live',
    model: 'grok-4.7',
    version: 3,
    ...partial,
  }
}

function passingTurn(fixture: ReplayFixtureV2) {
  return {
    text: 'Te cuento el precio.',
    outcome: 'suggest' as const,
    fallbackUsed: false,
    escalate: expectedReplayHandoff(fixture, false),
    blockedBy: [] as string[],
  }
}

describe('hasAiFullUnlock matrix (AT-P-4)', () => {
  it('fails closed on hash, agent, and model; version is a warning unless strict', () => {
    const missing = config()
    assert.equal(hasAiFullUnlock(missing, ACCOUNT, CTX), false)
    assert.equal(aiFullUnlockStatus(missing, ACCOUNT, CTX).reason, 'missing')

    const legacy = config({
      aiFullUnlock: { [ACCOUNT]: record({ agentId: undefined, model: undefined, agentVersion: undefined }) },
    })
    assert.equal(hasAiFullUnlock(legacy, ACCOUNT, CTX), true)
    assert.equal(hasAiFullUnlock(legacy, ACCOUNT), true)

    const ok = config({ aiFullUnlock: { [ACCOUNT]: record() } })
    assert.equal(hasAiFullUnlock(ok, ACCOUNT, CTX), true)
    assert.equal(aiFullUnlockStatus(ok, ACCOUNT, CTX).versionWarning, false)

    const staleHash = config({
      aiFullUnlock: { [ACCOUNT]: record({ fixtureSetHash: 'forge-wa-v1-a1-2026-09-21' }) },
    })
    assert.equal(hasAiFullUnlock(staleHash, ACCOUNT, CTX), false)
    assert.equal(aiFullUnlockStatus(staleHash, ACCOUNT, CTX).reason, 'hash')
    assert.equal(
      composeEffectiveBehavior({
        conversationAiMode: 'ai_active',
        operationMode: 'ai_full',
        unlockedForSend: hasAiFullUnlock(staleHash, ACCOUNT, CTX),
      }).behavior,
      'suggest',
    )

    const otherAgent = config({ aiFullUnlock: { [ACCOUNT]: record({ agentId: 'other' }) } })
    assert.equal(hasAiFullUnlock(otherAgent, ACCOUNT, CTX), false)
    assert.equal(aiFullUnlockStatus(otherAgent, ACCOUNT, CTX).reason, 'agent')
    assert.equal(hasAiFullUnlock(otherAgent, ACCOUNT), true)

    const otherModel = config({ aiFullUnlock: { [ACCOUNT]: record({ model: 'grok-4.6' }) } })
    assert.equal(hasAiFullUnlock(otherModel, ACCOUNT, CTX), false)
    assert.equal(aiFullUnlockStatus(otherModel, ACCOUNT, CTX).reason, 'model')

    const older = config({ aiFullUnlock: { [ACCOUNT]: record({ agentVersion: 2 }) } })
    const warned = aiFullUnlockStatus(older, ACCOUNT, CTX)
    assert.equal(warned.unlocked, true)
    assert.equal(warned.versionWarning, true)
    const strict = config({
      strictUnlockVersion: true,
      aiFullUnlock: { [ACCOUNT]: record({ agentVersion: 2 }) },
    })
    assert.equal(hasAiFullUnlock(strict, ACCOUNT, CTX), false)
    assert.equal(aiFullUnlockStatus(strict, ACCOUNT, CTX).reason, 'version')
  })

  it('parses absent knobs as D1 off and D2 on, and keeps optional unlock fields', () => {
    const parsed = parseChatAgentLayerConfig({})
    assert.equal(parsed.strictUnlockVersion, false)
    assert.equal(parsed.unlockCanaries, true)
    const explicit = parseChatAgentLayerConfig({ strictUnlockVersion: true, unlockCanaries: false })
    assert.equal(explicit.strictUnlockVersion, true)
    assert.equal(explicit.unlockCanaries, false)
    const round = parseChatAgentLayerConfig(
      chatAgentLayerConfigToJson(
        config({ aiFullUnlock: { [ACCOUNT]: record({ canaryCount: 5, agentVersion: 3 }) } }),
      ),
    )
    assert.equal(round.aiFullUnlock[ACCOUNT]?.canaryCount, 5)
    assert.equal(round.aiFullUnlock[ACCOUNT]?.agentVersion, 3)
    assert.equal(round.strictUnlockVersion, false)
    assert.equal(round.unlockCanaries, true)
  })

  it('formats canal status in plain Spanish', () => {
    const unlocked = realSendFromUnlockStatus(
      aiFullUnlockStatus(config({ aiFullUnlock: { [ACCOUNT]: record() } }), ACCOUNT, CTX),
    )
    assert.equal(formatRealSendStatus({ ...unlocked, versionWarning: unlocked.realSendVersionWarning }), 'Envío real: desbloqueado')
    const warned = realSendFromUnlockStatus(
      aiFullUnlockStatus(config({ aiFullUnlock: { [ACCOUNT]: record({ agentVersion: 2 }) } }), ACCOUNT, CTX),
    )
    assert.equal(
      formatRealSendStatus({ ...warned, versionWarning: warned.realSendVersionWarning }),
      'Envío real: desbloqueado · aprobado en v2',
    )
    assert.equal(
      formatRealSendStatus({
        realSend: 'locked',
        realSendReason: 'missing',
        versionWarning: false,
        approvedVersion: null,
      }),
      'Envío real: bloqueado',
    )
    assert.equal(
      formatRealSendStatus({
        realSend: 'stale',
        realSendReason: 'hash',
        versionWarning: false,
        approvedVersion: 3,
      }),
      'Envío real: aprobación vencida (la prueba cambió)',
    )
    assert.equal(
      formatRealSendStatus({
        realSend: 'stale',
        realSendReason: 'agent',
        versionWarning: false,
        approvedVersion: 3,
      }),
      'Envío real: aprobación vencida (el agente cambió)',
    )
    assert.equal(
      formatRealSendStatus({
        realSend: 'stale',
        realSendReason: 'model',
        versionWarning: false,
        approvedVersion: 3,
      }),
      'Envío real: aprobación vencida (el modelo cambió)',
    )
    const confirm = formatUnlockConfirm('WhatsApp tienda', 'Ventas')
    const line = formatUnlockSuccessLine({
      fixtureSetHash: HASH,
      passRate: 1,
      approvedByName: 'Ana',
      passedAtLabel: '22 sept 2026, 06:00',
    })
    assert.match(confirm, /Aprobar envío real/)
    assert.match(line, /Desbloqueado/)
    assert.doesNotMatch(`${confirm} ${line}`, /Soft/)
    const unbound = channelRealSendStatus(
      config({ aiFullUnlock: { [ACCOUNT]: record() } }),
      ACCOUNT,
      null,
    )
    assert.equal(unbound.realSend, 'locked')
  })
})

describe('unlock canaries and replay binding', () => {
  it('tags exactly the five D2 fixtures', () => {
    assert.deepEqual(
      FORGE_WA_V2_FIXTURES.filter((row) => row.canary).map((row) => row.id),
      ['v02', 'v04', 'v08', 'v13', 'v36'],
    )
  })

  it('rejects skip, fallback, confirmation wording, handoff mismatch, and budget', () => {
    const fixture = FORGE_WA_V2_FIXTURES.find((row) => row.id === 'v02')
    assert.ok(fixture)
    const base = {
      fixture,
      sharePaymentFacts: false,
      outcome: 'suggest' as const,
      fallbackUsed: false,
      escalate: false,
      text: 'Son ₡12000',
      blockedBy: [] as string[],
    }
    assert.equal(assessUnlockCanaryTurn(base).ok, true)
    assert.equal(assessUnlockCanaryTurn({ ...base, outcome: 'skip' }).ok, false)
    assert.equal(assessUnlockCanaryTurn({ ...base, fallbackUsed: true }).ok, false)
    assert.equal(assessUnlockCanaryTurn({ ...base, text: 'pago confirmado' }).ok, false)
    assert.equal(assessUnlockCanaryTurn({ ...base, escalate: true }).ok, false)
    const budget = assessUnlockCanaryTurn({ ...base, blockedBy: ['test_budget_blocked'] })
    assert.equal(budget.ok, false)
    if (!budget.ok) assert.equal(budget.reason, 'budget')
  })

  it('returns boundAgentId only for an in-tenant serving agent', () => {
    assert.deepEqual(
      replayAccountBinding({
        socialAccountId: ACCOUNT,
        accountInTenant: true,
        serving: { agentId: AGENT_ID, scope: 'social_account' },
      }),
      { socialAccountId: ACCOUNT, boundAgentId: AGENT_ID, bindingScope: 'social_account' },
    )
    assert.equal(
      replayAccountBinding({
        socialAccountId: ACCOUNT,
        accountInTenant: false,
        serving: { agentId: AGENT_ID, scope: 'social_account' },
      }).boundAgentId,
      null,
    )
    assert.equal(
      replayAccountBinding({ socialAccountId: null, accountInTenant: true, serving: null }).boundAgentId,
      null,
    )
  })
})

describe('approveAgentAiFullUnlock', () => {
  function harness(patch: AgentUnlockDeps = {}) {
    let stored = config()
    const audits: Array<Record<string, unknown>> = []
    const canaryIds: string[] = []
    const deps: AgentUnlockDeps = {
      now: () => new Date('2026-09-22T12:00:00.000Z'),
      findAccount: async () => ({ id: ACCOUNT, platform: 'whatsapp' }),
      readConfig: async () => stored,
      findAgent: async () => agent,
      findServing: async () => serving(),
      listShortcuts: async () => [],
      loadTestTokens: async () => 0,
      xaiConfigured: () => true,
      canaryFixtures: () => FORGE_WA_V2_FIXTURES.filter((row) => row.canary),
      replay: () => ({
        fixtureSetHash: HASH,
        passRate: 1,
        policyViolations: 0,
        rows: [],
        capped: false,
        examined: FORGE_WA_V2_FIXTURES.length,
      }),
      runCanaryTurn: async ({ fixture }) => {
        canaryIds.push(fixture.id)
        return passingTurn(fixture)
      },
      mutate: async (_tenantId, mutate) => {
        const before = stored
        const after = await mutate(stored)
        stored = after
        return { before, after }
      },
      audit: async (event) => {
        audits.push(event.details)
      },
      ...patch,
    }
    return { deps, audits, canaryIds, read: () => stored }
  }

  const input = {
    tenantId: 'tenant-1',
    agentId: AGENT_ID,
    socialAccountId: ACCOUNT,
    actorUserId: 'user-1',
    actorName: 'Ana',
    actorRole: 'OWNER',
  }

  async function refusal(patch: AgentUnlockDeps): Promise<AiFullUnlockRefusalCode> {
    const { deps } = harness(patch)
    try {
      await approveAgentAiFullUnlock(input, deps)
    } catch (error) {
      assert.equal(isAgentUnlockRefusal(error), true)
      if (!isAgentUnlockRefusal(error)) throw error
      return error.code
    }
    assert.fail('expected refusal')
  }

  it('writes the record and audits after a green replay and five canaries', async () => {
    const { deps, audits, canaryIds, read } = harness()
    const result = await approveAgentAiFullUnlock(input, deps)
    assert.deepEqual(canaryIds, ['v02', 'v04', 'v08', 'v13', 'v36'])
    assert.equal(result.record.passRate, 1)
    assert.equal(result.record.agentId, AGENT_ID)
    assert.equal(result.record.agentVersion, 3)
    assert.equal(result.record.model, 'grok-4.7')
    assert.equal(result.record.canaryCount, 5)
    assert.equal(result.record.fixtureSetHash, HASH)
    assert.equal(result.record.approvedBy, 'user-1')
    assert.equal(result.bindingScope, 'social_account')
    assert.equal(read().aiFullUnlock[ACCOUNT]?.agentId, AGENT_ID)
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.socialAccountId, ACCOUNT)
    assert.equal(audits[0]?.canaryCount, 5)
    assert.equal(audits[0]?.bindingScope, 'social_account')
  })

  it('maps every refusal code to HTTP 400 Spanish copy', async () => {
    const cases: Array<[AiFullUnlockRefusalCode, AgentUnlockDeps]> = [
      ['ACCOUNT_NOT_TENANT', { findAccount: async () => null }],
      ['ACCOUNT_NOT_ALLOWLISTED', { readConfig: async () => config({ accountAllowlist: [] }) }],
      ['ACCOUNT_NOT_WHATSAPP', { findAccount: async () => ({ id: ACCOUNT, platform: 'instagram' }) }],
      ['AGENT_NOT_BOUND', { findServing: async () => serving({ agentId: 'other' }) }],
      ['AGENT_NOT_LIVE', { findAgent: async () => ({ ...agent, status: 'draft' }) }],
      [
        'REPLAY_FAILED',
        {
          replay: () => ({
            fixtureSetHash: HASH,
            passRate: 0.5,
            policyViolations: 0,
            rows: [],
            capped: false,
            examined: 10,
          }),
        },
      ],
      [
        'HASH_MISMATCH',
        {
          replay: () => ({
            fixtureSetHash: 'other-hash',
            passRate: 1,
            policyViolations: 0,
            rows: [],
            capped: false,
            examined: 10,
          }),
        },
      ],
      [
        'CANARY_FAILED',
        {
          runCanaryTurn: async () => ({
            text: 'pago confirmado',
            outcome: 'suggest',
            fallbackUsed: false,
            escalate: false,
            blockedBy: [],
          }),
        },
      ],
      ['TEST_BUDGET_BLOCKED', { loadTestTokens: async () => 1_000 }],
      ['XAI_NOT_CONFIGURED', { xaiConfigured: () => false }],
    ]
    assert.equal(cases.length, AI_FULL_UNLOCK_REFUSAL_CODES.length)
    for (const [code, patch] of cases) {
      assert.equal(await refusal(patch), code)
      const http = agentUnlockHttpError(code)
      assert.equal(http.status, 400)
      assert.equal(http.body.code, code)
      assert.equal(http.body.success, false)
      assert.ok(http.body.error.length > 8)
      assert.doesNotMatch(http.body.error, /Soft|fixture|canary|hash/i)
    }
  })

  it('treats a post-canary model change as CANARY_FAILED and skips canaries when the knob is off', async () => {
    let reads = 0
    assert.equal(
      await refusal({
        findAgent: async () => {
          reads += 1
          return { ...agent, version: reads === 1 ? 3 : 4 }
        },
      }),
      'CANARY_FAILED',
    )

    let xaiReads = 0
    let canaries = 0
    const { deps, read } = harness({
      readConfig: async () => config({ unlockCanaries: false }),
      xaiConfigured: () => {
        xaiReads += 1
        return false
      },
      runCanaryTurn: async () => {
        canaries += 1
        throw new Error('canary should not run')
      },
      findAgent: async () => {
        reads += 1
        return { ...agent, version: 9 }
      },
    })
    const result = await approveAgentAiFullUnlock(input, deps)
    assert.equal(xaiReads, 0)
    assert.equal(canaries, 0)
    assert.equal(result.record.canaryCount, 0)
    assert.equal(result.record.agentVersion, 9)
    assert.equal(read().aiFullUnlock[ACCOUNT]?.agentVersion, 9)
  })

  it('drops an unlock when the serving agent changes or the binding is turned off', () => {
    assert.equal(
      shouldClearAccountUnlock({ nextActive: true, requestedAgentId: 'a', currentAgentId: 'b' }),
      true,
    )
    assert.equal(
      shouldClearAccountUnlock({ nextActive: true, requestedAgentId: 'a', currentAgentId: 'a' }),
      false,
    )
    assert.equal(
      shouldClearAccountUnlock({ nextActive: false, requestedAgentId: 'a', currentAgentId: 'a' }),
      true,
    )
    assert.equal(
      shouldClearAccountUnlock({ nextActive: false, requestedAgentId: 'a', currentAgentId: 'b' }),
      false,
    )
    assert.equal(
      shouldClearAccountUnlock({ nextActive: true, requestedAgentId: 'a', currentAgentId: null }),
      true,
    )
    const cleared = withoutAccountUnlock(
      config({ aiFullUnlock: { [ACCOUNT]: record(), other: record() } }),
      ACCOUNT,
    )
    assert.equal(cleared.aiFullUnlock[ACCOUNT], undefined)
    assert.ok(cleared.aiFullUnlock.other)
  })
})

describe('mutateChatAgentLayerConfig lock', () => {
  function memoryDb(initial: unknown): ChatAgentLayerFlagDb & { read: () => unknown } {
    let stored: unknown = initial
    let holder: symbol | null = null
    const waiters: Array<() => void> = []

    async function acquire(token: symbol) {
      while (holder && holder !== token) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
        })
      }
      holder = token
    }

    function release(token: symbol) {
      if (holder !== token) return
      holder = null
      const next = waiters.shift()
      next?.()
    }

    const db: ChatAgentLayerFlagDb = {
      $transaction: async (fn) => {
        const token = Symbol('tx')
        let locked = false
        try {
          return await fn({
            tenantFeatureFlag: {
              upsert: async () => {
                if (stored == null) {
                  stored = chatAgentLayerConfigToJson(DEFAULT_CHAT_AGENT_LAYER_CONFIG)
                }
              },
              update: async (args) => {
                stored = args.data.config
              },
            },
            $queryRaw: async <T,>() => {
              await acquire(token)
              locked = true
              return [{ config: stored }] as T
            },
          })
        } finally {
          if (locked) release(token)
        }
      },
    }
    return Object.assign(db, { read: () => stored })
  }

  it('keeps an allowlist edit and an unlock write that overlap', async () => {
    const db = memoryDb(chatAgentLayerConfigToJson(config()))
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let entered = false
    const enteredGate = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (entered) {
          clearInterval(timer)
          resolve()
        }
      }, 5)
    })

    const allowlistWrite = mutateChatAgentLayerConfig(
      'tenant-1',
      async (before) => {
        entered = true
        await gate
        return { ...before, accountAllowlist: [...before.accountAllowlist, 'acct-2'] }
      },
      db,
    )
    await enteredGate
    const unlockWrite = mutateChatAgentLayerConfig(
      'tenant-1',
      (before) => ({
        ...before,
        aiFullUnlock: {
          ...before.aiFullUnlock,
          [ACCOUNT]: {
            passedAt: '2026-09-22T12:00:00.000Z',
            approvedBy: 'user-1',
            fixtureSetHash: HASH,
            passRate: 1,
            agentId: AGENT_ID,
            agentVersion: 3,
            model: 'grok-4.7',
            canaryCount: 5,
          },
        },
      }),
      db,
    )
    releaseFirst()
    await Promise.all([allowlistWrite, unlockWrite])
    const finalConfig = parseChatAgentLayerConfig(db.read())
    assert.ok(finalConfig.accountAllowlist.includes(ACCOUNT))
    assert.ok(finalConfig.accountAllowlist.includes('acct-2'))
    assert.equal(finalConfig.aiFullUnlock[ACCOUNT]?.agentId, AGENT_ID)
  })

  it('locks the flag row and audits outside the transaction', () => {
    const mutateSrc = readFileSync(
      join(process.cwd(), 'src/lib/soft-ai/agent-layer-config-mutate.ts'),
      'utf8',
    )
    assert.match(mutateSrc, /FOR UPDATE/)
    assert.doesNotMatch(mutateSrc, /logAuditEvent/)
    const admin = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-admin.ts'), 'utf8')
    const panicStart = admin.indexOf('export async function panicRemoveAllowlist')
    const panicBody = admin.slice(panicStart, admin.indexOf('\nexport async function ', panicStart + 1))
    const mutateAt = panicBody.indexOf('mutateChatAgentLayerConfig')
    const auditAt = panicBody.indexOf('logAuditEvent')
    assert.ok(mutateAt > 0 && auditAt > mutateAt)
    assert.match(panicBody, /withoutAccountUnlock/)

    const gates = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-claim-gates.ts'), 'utf8')
    assert.match(gates, /agentVersion: binding\.agent\.version/)
    const resolver = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-resolver.ts'), 'utf8')
    assert.match(resolver, /agentVersion: agent\.version/)
    const turn = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.match(turn, /ignoreLayerFlag/)

    const shortcuts = readFileSync(join(process.cwd(), 'src/lib/soft-ai/shortcut-admin.ts'), 'utf8')
    for (const name of ['createShortcut', 'updateShortcut', 'deleteShortcut']) {
      const start = shortcuts.indexOf(`export async function ${name}`)
      const body = shortcuts.slice(start, shortcuts.indexOf('\nexport async function ', start + 1))
      assert.match(body, /\$transaction/, name)
      assert.match(body, /version:\s*\{\s*increment:\s*1\s*\}/, name)
      const txn = body.indexOf('$transaction')
      const audit = body.indexOf('logAuditEvent')
      assert.ok(audit > txn, name)
    }

    const route = readFileSync(
      join(process.cwd(), 'src/app/api/chat/agents/[id]/test/unlock/route.ts'),
      'utf8',
    )
    assert.match(route, /update_config/)
    assert.match(route, /agentUnlockHttpError/)
    assert.match(route, /chat_agent_ai_full_unlock|approveAgentAiFullUnlock/)
    const ui = readFileSync(join(process.cwd(), 'src/app/config/agentes/AgentInternalTests.tsx'), 'utf8')
    assert.match(ui, /Aprobar envío real/)
    assert.doesNotMatch(ui, /Soft/)
  })
})
