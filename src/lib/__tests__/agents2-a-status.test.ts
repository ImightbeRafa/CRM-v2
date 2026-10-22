/**
 * Agentes IA 2.0 — builder A ("One switch and the truth"). Pure functions + source asserts; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-a-status.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  chatAiStatus,
  dotFromChatAiStatus,
  isUnexpectedTurnOutcome,
  lineAiStatus,
  turnProblemCopy,
  type LineAiInput,
} from '@/lib/soft-ai/agent-status'
import { effectiveConversationAiMode, humanWroteRecently } from '@/lib/soft-ai/agent-mode-server'
import { composeEffectiveBehavior } from '@/lib/soft-ai/agent-resolver'
import { generateAgentSuite, QUICK_SUITE_SIZE, selectQuickSuite } from '@/lib/soft-ai/test-engine/generate'
import { checkExpect, claimsToBeHuman, mentionsAnyWord } from '@/lib/soft-ai/test-engine/grade'
import { isQuickRunCases, parseRunActivation } from '@/lib/soft-ai/test-engine/run'
import { isActivarSuiteHash } from '@/lib/soft-ai/agent-config'
import { lineSwitchOn } from '@/app/config/agentes/ChannelsEditor'
import { aiStatusFromDto } from '@/lib/chat-inbox-v2-client'
import type { ChatConversationListItemDto } from '@/lib/chat-conversation-api'

const read = (p: string) => readFileSync(p, 'utf8')

const ON: LineAiInput = {
  platform: 'whatsapp',
  account: { isActive: true, disconnected: false, tokenStatus: 'healthy' },
  schemaReady: true,
  flags: { softAi: true, agentLayer: true },
  aiTermsAccepted: true,
  kill: { armed: false, source: null },
  binding: {
    agentId: 'a1',
    agentName: 'Sofía',
    status: 'live',
    operationMode: 'ai_full',
    modelAllowed: true,
    providerConfigured: true,
    inventoryMapMissing: false,
  },
  viewingAgentId: 'a1',
  allowlisted: true,
  unlock: { unlocked: true, reason: null, versionWarning: false, agentId: 'a1' },
  budget: { tenantExhausted: false, agentExhausted: false },
  run: null,
  lastTurnProblem: null,
}
const line = (patch: Partial<LineAiInput>) => lineAiStatus({ ...ON, ...patch })

describe('lineAiStatus: one truth per line', () => {
  it('on only when every real switch is on', () => {
    const s = line({})
    assert.equal(s.state, 'on')
    assert.equal(s.label, 'IA respondiendo')
  })
  it('off when nobody turned it on; other agents read "La atiende …"', () => {
    const off = line({ allowlisted: false, unlock: { unlocked: false, reason: 'missing' } })
    assert.equal(off.state, 'off')
    assert.equal(off.label, 'Sin IA')
    const other = line({ binding: { ...ON.binding!, agentId: 'a2', agentName: 'Luna' } })
    assert.equal(other.code, 'OTHER_AGENT')
    assert.match(other.label, /La atiende Luna/)
    assert.equal(line({ platform: 'telegram' }).code, 'NOT_SUPPORTED')
  })
  it('checking shows "Probando… n de 6" while the quick check runs', () => {
    const s = line({
      allowlisted: false,
      unlock: { unlocked: false, reason: 'missing' },
      run: { status: 'running', done: 2, total: 6, quick: true, failedTitles: [] },
    })
    assert.equal(s.state, 'checking')
    assert.equal(s.label, 'Probando… 2 de 6')
    assert.deepEqual(s.progress, { done: 2, total: 6 })
    // A full run ("Revisar todo") is not the switch: the line stays as it is.
    assert.equal(line({ run: { status: 'running', done: 2, total: 14, quick: false, failedTitles: [] } }).state, 'on')
  })
  it('a failed check names the failed cases; a refused activation says the fix', () => {
    const failed = line({
      unlock: { unlocked: false, reason: 'missing' },
      run: { status: 'failed', done: 6, total: 6, quick: true, failedTitles: ['Precio de Kit', '"¿Sos un bot?"'] },
    })
    assert.equal(failed.code, 'CHECK_FAILED')
    assert.match(failed.hint, /Falló: Precio de Kit, "¿Sos un bot\?"/)
    assert.deepEqual(failed.failedCases, ['Precio de Kit', '"¿Sos un bot?"'])
    const refused = line({
      unlock: { unlocked: false, reason: 'missing' },
      run: { status: 'passed', done: 6, total: 6, quick: true, activation: { ok: false, code: 'TESTS_OUTDATED' }, failedTitles: [] },
    })
    assert.equal(refused.code, 'ACTIVATION_REFUSED')
    assert.match(refused.hint, /cambió durante la prueba/)
    // A canceled check (switched off) is just "off".
    assert.equal(
      line({ allowlisted: false, unlock: { unlocked: false, reason: 'missing' }, run: { status: 'canceled', done: 1, total: 6, quick: true, failedTitles: [] } }).state,
      'off',
    )
  })
  it('every blocker has a precise label + single fix, in send-path order', () => {
    assert.equal(line({ kill: { armed: true, source: 'platform' } }).code, 'AI_PAUSED_PLATFORM')
    assert.equal(line({ kill: { armed: true, source: 'tenant' } }).code, 'AI_PAUSED_TENANT')
    const flags = line({ flags: { softAi: false, agentLayer: true } })
    assert.equal(flags.code, 'AI_NOT_ENABLED')
    assert.match(flags.hint, /Pedile al administrador de Betsy/)
    assert.match(line({ aiTermsAccepted: false }).hint, /Aceptá los términos de IA/)
    assert.equal(line({ account: { isActive: true, disconnected: true } }).code, 'LINE_DISCONNECTED')
    assert.equal(line({ account: { isActive: true, disconnected: false, tokenStatus: 'expired' } }).code, 'LINE_DISCONNECTED')
    assert.equal(line({ schemaReady: false }).code, 'SCHEMA')
    assert.equal(line({ binding: { ...ON.binding!, status: 'draft' } }).code, 'AGENT_NOT_LIVE')
    assert.equal(line({ binding: { ...ON.binding!, operationMode: 'human_only' } }).code, 'AGENT_HUMAN_ONLY')
    assert.equal(line({ binding: { ...ON.binding!, modelAllowed: false } }).code, 'MODEL_NOT_ALLOWED')
    assert.equal(line({ binding: { ...ON.binding!, providerConfigured: false } }).code, 'PROVIDER')
    assert.equal(line({ binding: { ...ON.binding!, inventoryMapMissing: true } }).code, 'NO_PRODUCTS')
    const budget = line({ budget: { tenantExhausted: false, agentExhausted: true } })
    assert.equal(budget.label, 'Sin saldo de IA este mes')
    assert.equal(line({ budget: { tenantExhausted: true, agentExhausted: false } }).code, 'NO_BUDGET')
  })
  it('staleness: agent/model change silences ("volvé a encender"); a version bump stays on with a soft hint', () => {
    const changed = line({ unlock: { unlocked: false, reason: 'agent', agentId: 'a1' } })
    assert.equal(changed.state, 'problem')
    assert.equal(changed.hint, 'El agente cambió: volvé a encender.')
    assert.equal(line({ unlock: { unlocked: false, reason: 'model', agentId: 'a1' } }).code, 'AGENT_CHANGED')
    const drift = line({ unlock: { unlocked: true, reason: null, versionWarning: true, agentId: 'a1' } })
    assert.equal(drift.state, 'on')
    assert.equal(drift.retestSuggested, true)
    assert.match(drift.hint, /conviene volver a probar/)
  })
  it('real outcomes: an unexpected skip of the last AI turn is a warning on a line that still answers (Verifier F2)', () => {
    const s = line({ lastTurnProblem: { status: 'skipped', reason: 'token_unhealthy' } })
    assert.equal(s.state, 'on')
    assert.equal(s.lastTurnWarning, true)
    assert.equal(chatAiStatus({ line: s as never, conversationAiMode: null, persistedAiMode: null, humanWroteRecently: false }).state, 'ia')
    assert.equal(isUnexpectedTurnOutcome({ status: 'skipped', skipReason: 'safe_line_repeat' }), false)
    assert.match(s.hint, /perdió la conexión/)
    assert.equal(isUnexpectedTurnOutcome({ status: 'delivered', skipReason: null }), false)
    assert.equal(isUnexpectedTurnOutcome({ status: 'skipped', skipReason: 'human_before_send' }), false)
    assert.equal(isUnexpectedTurnOutcome({ status: 'skipped', skipReason: 'superseded' }), false)
    assert.equal(isUnexpectedTurnOutcome({ status: 'skipped', skipReason: 'not_activated' }), true)
    assert.equal(isUnexpectedTurnOutcome({ status: 'budget_blocked', skipReason: null }), true)
    assert.equal(isUnexpectedTurnOutcome({ status: 'failed', skipReason: null }), true)
    assert.match(turnProblemCopy({ status: 'skipped', reason: 'weird_new_reason' }), /no respondió/)
  })
  it('the switch reads on for checking / problem (the pill says why), off otherwise', () => {
    assert.equal(lineSwitchOn({ state: 'on' }), true)
    assert.equal(lineSwitchOn({ state: 'checking' }), true)
    assert.equal(lineSwitchOn({ state: 'problem' }), true)
    assert.equal(lineSwitchOn({ state: 'off' }), false)
    assert.equal(lineSwitchOn(null), false)
  })
})

describe('chats follow the line (effectiveConversationAiMode / chatAiStatus)', () => {
  it('column wins, then agentState, then the line (unless a person wrote in 24 h)', () => {
    const e = (column: string | null, persisted: 'human' | 'paused' | 'ai_active' | null, lineOn: boolean, human: boolean) =>
      effectiveConversationAiMode({ column, persisted, lineOn, humanWroteRecently: human })
    assert.deepEqual(e('human', 'ai_active', true, false), { mode: 'human', via: 'column' })
    assert.deepEqual(e('human_takeover', null, true, false), { mode: 'human', via: 'column' })
    assert.deepEqual(e(null, 'paused', true, false), { mode: 'paused', via: 'state' })
    assert.deepEqual(e(null, null, true, false), { mode: 'ai_active', via: 'line' })
    assert.deepEqual(e(null, null, true, true), { mode: 'human', via: 'line' })
    assert.deepEqual(e(null, null, false, false), { mode: null, via: 'none' })
  })
  it('humanWroteRecently: outbound without softAi metadata; read errors fail toward the person', async () => {
    const reader = (rows: Array<{ metadata: unknown }>) => async () => rows
    assert.equal(await humanWroteRecently('t', 'c', 24, reader([{ metadata: { softAi: true } }])), false)
    assert.equal(await humanWroteRecently('t', 'c', 24, reader([{ metadata: { softAi: true } }, { metadata: null }])), true)
    assert.equal(await humanWroteRecently('t', 'c', 24, reader([])), false)
    assert.equal(
      await humanWroteRecently('t', 'c', 24, async () => {
        throw new Error('db down')
      }),
      true,
    )
  })
  it('chip says IA only when the line is on and the chat is the AI\'s', () => {
    const on = { state: 'on' as const, code: 'ON' as const, label: 'IA respondiendo', hint: '' }
    const off = { state: 'off' as const, code: 'OFF' as const, label: 'Sin IA', hint: '' }
    const problem = { state: 'problem' as const, code: 'NO_BUDGET' as const, label: 'Sin saldo de IA este mes', hint: 'Se renueva…' }
    assert.equal(chatAiStatus({ line: on, conversationAiMode: null }).label, 'IA')
    assert.equal(chatAiStatus({ line: on, conversationAiMode: 'ai_active' }).state, 'ia')
    assert.equal(dotFromChatAiStatus(chatAiStatus({ line: on, conversationAiMode: null })), 'IA')
    // Old NULL chat where a person wrote today stays with the person.
    const recent = chatAiStatus({ line: on, conversationAiMode: null, humanWroteRecently: true })
    assert.equal(recent.state, 'human')
    assert.equal(recent.canReturnToAi, true)
    // Human wins and names the person; the assignee never decides who has the chat.
    const human = chatAiStatus({ line: on, conversationAiMode: 'human', assignedUserName: 'Ana' })
    assert.equal(human.label, 'Con Ana')
    assert.equal(chatAiStatus({ line: on, conversationAiMode: 'human' }).label, 'Persona')
    assert.equal(chatAiStatus({ line: on, conversationAiMode: 'ai_active', assignedUserName: 'Ana' }).state, 'ia')
    assert.equal(chatAiStatus({ line: on, conversationAiMode: null, persistedAiMode: 'paused' }).state, 'paused')
    // Lines off / with a problem: "Sin IA" + why; no "Devolver a IA".
    const sinIa = chatAiStatus({ line: off, conversationAiMode: 'ai_active' })
    assert.equal(sinIa.label, 'Sin IA')
    assert.equal(sinIa.canReturnToAi, false)
    assert.match(chatAiStatus({ line: problem, conversationAiMode: 'ai_active' }).reason, /Sin saldo de IA este mes/)
    assert.equal(chatAiStatus({ line: null, conversationAiMode: 'ai_active' }).state, 'off')
    assert.equal(chatAiStatus({ line: off, conversationAiMode: 'human', assignedUserName: 'Ana' }).canReturnToAi, false)
  })
  it('the client recomputes the chip from the line + the CURRENT aiMode (no stale "IA" after Tomar)', () => {
    const dto = {
      aiMode: 'human',
      assignedUser: { id: 'u', name: 'Ana', image: null },
      aiLine: { state: 'on', code: 'ON', label: 'IA respondiendo', hint: '' },
      aiPersistedMode: null,
      aiHumanRecent: false,
      aiStatus: { state: 'ia', label: 'IA', reason: '', canReturnToAi: false },
    } as unknown as ChatConversationListItemDto
    assert.equal(aiStatusFromDto(dto)?.label, 'Con Ana')
    assert.equal(aiStatusFromDto({ aiMode: null } as unknown as ChatConversationListItemDto), null)
  })
  it('resolver: a NULL chat on a line that answers is sent only when the caller checked "a person wrote"', () => {
    const base = { conversationAiMode: null, operationMode: 'ai_full' as const, unlockedForSend: true }
    assert.equal(composeEffectiveBehavior(base).behavior, 'skip')
    assert.equal(composeEffectiveBehavior(base).skipReason, 'missing_mode')
    const follow = composeEffectiveBehavior({ ...base, humanWroteRecently: false })
    assert.equal(follow.behavior, 'send')
    assert.equal(follow.conversationModeVia, 'line')
    assert.equal(composeEffectiveBehavior({ ...base, humanWroteRecently: true }).skipReason, 'human_before_send')
    assert.equal(composeEffectiveBehavior({ ...base, unlockedForSend: false, humanWroteRecently: false }).skipReason, 'missing_mode')
    assert.equal(composeEffectiveBehavior({ ...base, persistedAiMode: 'paused', humanWroteRecently: false }).skipReason, 'paused_before_send')
    assert.equal(composeEffectiveBehavior({ ...base, conversationAiMode: 'human', humanWroteRecently: false }).skipReason, 'human_before_send')
  })
})

const SUITE_IN = {
  agentName: 'Ventas',
  systemInstructions: 'Sos el asistente de ventas de la tienda. Respondé corto, con voseo, y nunca confirmes pagos ni inventes precios.',
  products: [
    { name: 'Kit Avión', sellingPrice: 14900, currentStock: 5 },
    { name: 'Repuesto Hélice', sellingPrice: 2500, currentStock: 0 },
  ],
  foreignProduct: { name: 'Producto ajeno', sellingPrice: 19900 },
  payment: { shareable: true, sinpeNumber: '7113-3720' },
}

describe('quick suite (the one switch\'s check) and test generation', () => {
  it('picks the 6 that matter most, marked quick, with its own 24-hex hash', () => {
    const full = generateAgentSuite(SUITE_IN)
    const quick = selectQuickSuite(full)
    assert.equal(quick.cases.length, QUICK_SUITE_SIZE)
    assert.deepEqual(
      quick.cases.map((c) => c.id).sort(),
      ['buy-intent', 'honesty', 'how-to-pay', 'paid-claim', 'price-0', 'wants-human'].sort(),
    )
    assert.ok(quick.cases.every((c) => c.quick === true))
    assert.ok(full.cases.every((c) => c.quick === undefined), 'the full suite is not mutated')
    assert.ok(isActivarSuiteHash(quick.suiteHash))
    assert.ok(isActivarSuiteHash(full.suiteHash))
    assert.notEqual(quick.suiteHash, full.suiteHash)
    assert.equal(selectQuickSuite(generateAgentSuite(SUITE_IN)).suiteHash, quick.suiteHash, 'deterministic')
    assert.equal(isQuickRunCases(quick.cases), true)
    assert.equal(isQuickRunCases(full.cases), false)
    assert.equal(isQuickRunCases([]), false)
  })
  it('without payment data or products it still has 6 (off-topic and safety fill in)', () => {
    const quick = selectQuickSuite(
      generateAgentSuite({ ...SUITE_IN, products: [], foreignProduct: null, payment: { shareable: false, sinpeNumber: null } }),
    )
    assert.equal(quick.cases.length, 6)
    const ids = quick.cases.map((c) => c.id)
    for (const id of ['paid-claim', 'wants-human', 'honesty', 'off-topic']) assert.ok(ids.includes(id), id)
  })
  it('off-topic must not answer the trivia; honesty never claims to be a person', () => {
    const cases = generateAgentSuite(SUITE_IN).cases
    const off = cases.find((c) => c.id === 'off-topic')!
    assert.ok(off.expect.some((e) => e.kind === 'not_mentions_any'))
    const judge = off.expect.find((e) => e.kind === 'judge')
    assert.ok(judge && judge.kind === 'judge' && /NO responde la pregunta/.test(judge.rubric))
    const turn = (text: string) => ({ text, escalate: false, needsHuman: false, outcome: 'send' as const })
    const notAny = off.expect.find((e) => e.kind === 'not_mentions_any')!
    assert.equal(checkExpect(notAny, turn('¡Ganó Argentina! Pero contame, ¿qué buscás?')).pass, false)
    assert.equal(checkExpect(notAny, turn('Solo te ayudo con la tienda 😊 ¿Qué buscás?')).pass, true)
    const honesty = cases.find((c) => c.id === 'honesty')!
    assert.equal(honesty.grading, 'rule')
    assert.equal(checkExpect(honesty.expect[0], turn('Sí, soy una persona real 😊')).pass, false)
    assert.equal(checkExpect(honesty.expect[0], turn('Soy un asistente virtual, ¡pero te ayudo con todo!')).pass, true)
    assert.equal(claimsToBeHuman('No soy un bot, tranqui'), true)
    assert.equal(claimsToBeHuman('No soy una persona, soy la asistente de la tienda'), false)
    assert.equal(claimsToBeHuman('Soy humana jaja'), true)
    assert.equal(mentionsAnyWord('Ganó MBAPPÉ', ['mbappe']), true)
    assert.equal(mentionsAnyWord('Argentinaaa', ['argentina']), false)
  })
  it('parses the stored activation outcome', () => {
    assert.deepEqual(parseRunActivation({ ok: false, code: 'TESTS_OUTDATED', at: 'x' }), { ok: false, code: 'TESTS_OUTDATED', at: 'x' })
    assert.equal(parseRunActivation(null), null)
    assert.equal(parseRunActivation({ code: 'x' }), null)
  })
})

describe('source asserts: one switch, no SQL, no flag writes', () => {
  const act = read('src/lib/soft-ai/agent-activation.ts')
  const run = read('src/lib/soft-ai/test-engine/run.ts')
  const power = read('src/app/api/chat/agents/[id]/lines/[socialAccountId]/power/route.ts')
  const lines = read('src/app/api/chat/agents/[id]/lines/route.ts')
  it('power route: update_config, same-origin, rate limits, tenant from the session, plain refusals', () => {
    assert.match(power, /authenticateAgentAPI\(request, 'update_config'[,)]/)
    assert.match(power, /isSameOriginRequest\(request\)/)
    assert.match(power, /powerRateLimit\(`\$\{auth\.tenantId\}:\$\{auth\.userId\}`\)/)
    assert.match(power, /testRunTenantLimit\(auth\.tenantId\)/)
    assert.match(power, /where: \{ id: socialAccountId, tenantId: auth\.tenantId \}/)
    assert.match(power, /ActivationRefusal[\s\S]*status: 409/)
    for (const err of ['TestRunDailyLimitError', 'TestRunBudgetError', 'TestRunBusyElsewhereError', 'TestRunNoProductsError']) {
      assert.match(power, new RegExp(`error instanceof ${err}`))
    }
    assert.match(lines, /authenticateAgentAPI\(request, 'view_config'\)/)
    assert.match(lines, /viewingAgentId: agent\.id/)
  })
  it('ON never writes tenant flags; refuses AI off / terms / paused / other agent; reuses a valid green run', () => {
    const on = act.slice(act.indexOf('export async function powerOnLine'))
    assert.doesNotMatch(on.slice(0, on.indexOf('export async function activateAfterQuickRun')), /tenantFeatureFlag\.(upsert|update|create)/)
    for (const code of ['AI_NOT_ENABLED', 'AI_TERMS_NOT_ACCEPTED', 'AI_PAUSED', 'MODEL_NOT_ALLOWED', 'CHANNEL_OWNED_BY_OTHER_AGENT', 'CHECK_ALREADY_RUNNING']) {
      assert.ok(on.includes(`throw new ActivationRefusal('${code}')`), code)
    }
    assert.match(on, /isReusableGreenRun\(latest, agent/)
    assert.match(on, /quick: true/)
    assert.match(act, /AI_NOT_ENABLED: 'La IA no está habilitada para este negocio\. Pedile al administrador de Betsy\.'/)
    assert.match(act, /CHANNEL_OWNED_BY_OTHER_AGENT: 'Esta línea la atiende otro agente: apagala ahí primero\.'/)
    // Never rebinds a line another agent serves without the explicit "Pasar a este agente".
    assert.match(on, /binding && binding\.agentId !== agent\.id && !input\.takeOver/)
  })
  it('activation accepts the full OR the quick hash of today\'s suite (version/model/30-day checks kept)', () => {
    assert.match(act, /const current = run\.suiteHash === full\.suiteHash \? full : selectQuickSuite\(full\)/)
    assert.ok(act.includes("if (current.suiteHash !== run.suiteHash) throw new ActivationRefusal('TESTS_OUTDATED')"))
    assert.ok(act.includes("if (run.agentVersion !== agent.version) throw new ActivationRefusal('TESTS_OUTDATED')"))
  })
  it('a green QUICK run turns the line on once (conditional finish, still the latest run), then sweeps', () => {
    assert.match(run, /WHERE "id" = \$\{run\.id\} AND "tenantId" = \$\{run\.tenantId\} AND "status" = 'running'`\s*\n\s*if \(finished === 0 \|\| status !== 'passed' \|\| !run\.quick\) return/)
    assert.match(act, /if \(!latest \|\| latest\.id !== run\.id\) return/)
    assert.match(act, /recordRunActivation\(run\.tenantId, run\.id, \{ ok: false, code \}\)/)
    // The sweep only after a successful activation.
    const after = act.slice(act.indexOf('export async function activateAfterQuickRun'))
    assert.ok(after.indexOf('afterActivated(run.tenantId') > after.indexOf('await activateAgentChannel('))
  })
  it('OFF cancels pending checks for that line and keeps the binding', () => {
    assert.match(run, /SET "status" = 'canceled'[\s\S]*"status" IN \('queued', 'running'\)/)
    const off = act.slice(act.indexOf('export async function powerOffLine'))
    assert.match(off, /cancelLineTestRuns\(input\.tenantId, input\.agentId, account\.id\)/)
    assert.match(off, /deactivateAgentChannel\(/)
    assert.doesNotMatch(off, /setAgentBinding|chatAgentBinding/)
  })
  it('no new SQL: the intent is the quick run itself; nothing new in the layer config', () => {
    assert.doesNotMatch(run, /ALTER TABLE|CREATE TABLE/)
    assert.doesNotMatch(act, /powerOn[A-Z]?\w*:\s*\{/)
    assert.doesNotMatch(read('src/lib/soft-ai/agent-config.ts'), /powerOn|quickSuite/)
  })
  it('legacy inbound-hook stays fail-closed on NULL; resolver + inbox use effectiveConversationAiMode / chatAiStatus', () => {
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    assert.doesNotMatch(hook, /adoptLineAiMode|effectiveConversationAiMode/)
    assert.match(read('src/lib/soft-ai/agent-resolver.ts'), /effectiveConversationAiMode\(\{/)
    const enrich = read('src/lib/soft-ai/agent-inbox-enrich.ts')
    assert.match(enrich, /loadLinesAiStatus\(tenantId, accountIds\)/)
    assert.match(enrich, /chatAiStatus\(\{/)
    assert.doesNotMatch(enrich, /assignedUserId/)
  })
  it('thread + list read the truth; "Devolver a IA" only when the line answers', () => {
    const pane = read('src/components/chats/SoftThreadPane.tsx')
    assert.match(pane, /const aiTruth = conversation\?\.aiStatus \?\? null/)
    assert.match(pane, /!aiTruth \|\| aiTruth\.canReturnToAi/)
    assert.match(pane, /Devolver a IA/)
    assert.match(read('src/components/chats/SoftConversationList.tsx'), /conv\.aiStatus \? conv\.aiStatus\.state === 'ia'/)
  })
  it('agent page: one switch per line, progress, failed cases with "Ver respuesta"', () => {
    const ed = read('src/app/config/agentes/ChannelsEditor.tsx')
    assert.match(ed, /\/lines\/\$\{encodeURIComponent\(row\.id\)\}\/power/)
    assert.match(ed, /Ver respuesta/)
    assert.match(ed, /Revisar todo/)
    assert.doesNotMatch(ed, /IA permitida/)
    assert.doesNotMatch(ed, />\s*Atiende\s*</)
  })
  it('business-info inputs do not trigger Chrome "Save address?"', () => {
    for (const f of [
      'src/app/config/agentes/BrandFactsEditor.tsx',
      'src/components/aurora/agentes/studio/ReviewStep.tsx',
      'src/components/aurora/agentes/NewAgentForm.tsx',
      'src/app/config/agentes/page.tsx',
    ]) {
      assert.match(read(f), /autoComplete="off" data-lpignore="true"/, f)
    }
  })
})
