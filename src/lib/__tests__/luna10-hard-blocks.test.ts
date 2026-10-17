/**
 * luna-10 hard blocks (2026-10-17, PatchHouse live chats): code-owned stops for the mistakes the model made.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as fs from 'node:fs'
import { resultsClaimIn, validateAgentOutput } from '../soft-ai/llm/output-validator'
import { REPAIRABLE_REASONS, repairInstruction } from '../soft-ai/llm/runtime'
import { decideWaitingAck, isOptOutText, waitingAckKey, waitingAckText } from '../soft-ai/waiting-ack'
import { customerAsksAgain, dropRepeatedParts, isNearRepeat } from '../soft-ai/repeat-guard'
import { SHIPPING_DATA_LIST } from '../soft-ai/order-data-list'
import { parseSalesRules } from '../soft-ai/agent-sales-setup'
import { afterHoursHandoffLine, afterHoursPromptLine, afterHoursState, applyAfterHoursText, withNightIntro } from '../soft-ai/business-hours'
import { HANDOFF_REASON_LABELS } from '../workspace-notifications'

describe('results_claim (no promised effects)', () => {
  const promises = [
    'Muchas personas notan cambios en los primeros días, y con uso constante se nota más.',
    'Cada organismo responde diferente, pero muchas personas nos cuentan que notan cambios en los primeros días',
    'La mayoría de las personas sienten la diferencia desde la primera semana',
    'Vas a notar cambios rápido 😊',
    'Vas a poder ver resultados con uso constante',
    'Notarás la diferencia en pocos días',
    'Resultados en 7 días',
    'Te garantizo que te va a funcionar',
    'Esto cura la ansiedad',
    'Con el GLP-1 vas a bajar de peso',
    'Te ayuda a adelgazar',
  ]
  for (const text of promises) {
    it(`blocks: ${text}`, () => {
      assert.ok(resultsClaimIn(text), text)
      assert.ok(validateAgentOutput({ text, citedToolNames: [] }).reasons.includes('results_claim'))
    })
  }

  const allowed = [
    'El GLP-1 apoya el control del apetito y ayuda a reducir antojos; es un complemento para tus hábitos de alimentación.',
    'Es un complemento, no un medicamento, y no promete bajar de peso.',
    'Cada persona responde diferente; los resultados no están garantizados 🌿',
    'Cada organismo responde diferente: es un suplemento de bienestar, no un medicamento, y se aprovecha más con uso constante (uno al día, unas 8 horas).',
    'El Stress Relief apoya la relajación y el equilibrio emocional en días de mucha carga, sin causar sueño 😌',
    'Energy: energía sostenida con liberación gradual hasta por 8 horas.',
    'Nuestros parches no curan ni tratan enfermedades; con hipotiroidismo consultá a tu médico 💚',
    'Llega en 2 a 5 días hábiles.',
    'Muchas personas los llevan en combo 😊',
  ]
  for (const text of allowed) {
    it(`allows: ${text}`, () => {
      assert.equal(resultsClaimIn(text), null, text)
      assert.ok(!validateAgentOutput({ text, citedToolNames: [] }).reasons.includes('results_claim'))
    })
  }

  it('is repairable and the rewrite request says why (never customer text)', () => {
    assert.ok(REPAIRABLE_REASONS.has('results_claim'))
    assert.match(repairInstruction(['results_claim']), /prometiste un resultado/)
  })
})

describe('waiting ack (customer writes again while a hand-off waits on a person)', () => {
  const now = new Date('2026-10-17T18:00:00Z')
  const handoff = { id: 'turn_handoff_1', handoffKind: 'handoff', completedAt: new Date('2026-10-17T17:50:00Z') }
  const base = { lastTurn: handoff, humanWroteSince: false, lineOn: true, alreadyAcked: false, now }

  it('first message after an agent hand-off: one ack + team alert', () => {
    assert.deepEqual(decideWaitingAck(base), { ack: true, realert: true, reason: 'customer_waiting' })
  })
  it('later messages: no second ack, but the team is alerted again', () => {
    assert.deepEqual(decideWaitingAck({ ...base, alreadyAcked: true }), { ack: false, realert: true, reason: 'already_acked' })
  })
  it('a person already wrote after the hand-off: silent', () => {
    assert.equal(decideWaitingAck({ ...base, humanWroteSince: true }).realert, false)
  })
  it('a person took the chat by hand (last agent turn was not a hand-off): silent', () => {
    assert.equal(decideWaitingAck({ ...base, lastTurn: { ...handoff, handoffKind: 'review' } }).realert, false)
    assert.equal(decideWaitingAck({ ...base, lastTurn: { ...handoff, handoffKind: null } }).realert, false)
    assert.equal(decideWaitingAck({ ...base, lastTurn: null }).realert, false)
  })
  it('line off or hand-off older than 24 h: silent', () => {
    assert.equal(decideWaitingAck({ ...base, lineOn: false }).realert, false)
    assert.equal(decideWaitingAck({ ...base, lastTurn: { ...handoff, completedAt: new Date('2026-10-16T17:00:00Z') } }).realert, false)
  })
  it('texts: in hours vs after hours (never promises an immediate answer at night)', () => {
    assert.equal(waitingAckText({ afterHours: false, label: '' }), 'Ya le avisé al equipo 🙌 En un momento te escriben por aquí 😊')
    assert.equal(waitingAckText({ afterHours: true, label: 'mañana a las 8:00 a. m.' }), 'Ya le avisé al equipo 🙌 Te escriben mañana a las 8:00 a. m. 😊')
    assert.equal(waitingAckKey('t1'), 'waiting_ack:t1')
  })
  it('the alert has its own label', () => {
    assert.equal(HANDOFF_REASON_LABELS.customer_waiting, 'El cliente sigue esperando — nadie le respondió')
  })
})

describe('repeat guard (never send what the chat just got)', () => {
  const list = 'Contame, ¿sobre cuál parche querés info?\n\n- Focus (concentración) - Energy (energía) - Stress Relief (calma) - Dopamine (ánimo) - GLP-1 (apetito)'
  it('drops the product list the customer already saw (2026-10-16 live chat)', () => {
    const r = dropRepeatedParts({ text: '- Focus (concentración) - Energy (energía) - Stress Relief (calma) - Dopamine (ánimo) - GLP-1 (apetito)', previous: [list], customerText: 'Calma' })
    assert.equal(r.kept.length, 0)
    assert.equal(r.dropped.length, 1)
  })
  it('drops the repeated line but keeps the new part', () => {
    const prev = ['La fórmula calmante es la mezcla Stress Down, junto con complejo B 😌']
    const r = dropRepeatedParts({ text: 'La mezcla calmante se llama Stress Down y va con complejo B 😌\n\nLleva lichi, corteza de magnolia, té verde, GABA y ashwagandha.', previous: prev, customerText: 'qué componentes tiene?' })
    assert.deepEqual(r.kept, ['Lleva lichi, corteza de magnolia, té verde, GABA y ashwagandha.'])
  })
  it('the same closing question twice is dropped; short acknowledgements may repeat', () => {
    assert.ok(isNearRepeat('¿Te lo llevás? ¿Te lo enviamos o lo retirás con cita?', ['¿Te lo llevás? ¿Te lo enviamos o lo retirás con cita?']))
    assert.equal(isNearRepeat('¡Perfecto! 😊', ['¡Perfecto! 😊']), false)
  })
  it('different content passes', () => {
    const r = dropRepeatedParts({ text: 'El envío a Cartago es ₡3 000 y tarda de 2 a 5 días hábiles.', previous: [list], customerText: 'cuanto es el envio' })
    assert.equal(r.dropped.length, 0)
  })
  it('the customer asks for it again: nothing is dropped', () => {
    assert.ok(customerAsksAgain('me lo pasás de nuevo?'))
    assert.ok(customerAsksAgain('no me llegó'))
    const r = dropRepeatedParts({ text: list, previous: [list], customerText: 'me lo podés mandar otra vez?' })
    assert.equal(r.dropped.length, 0)
  })
  it('a reply never repeats itself inside', () => {
    const r = dropRepeatedParts({ text: 'Es un suplemento de bienestar, no un medicamento.\n\nEs un suplemento de bienestar, no un medicamento.', previous: ['hola'], customerText: 'x' })
    assert.equal(r.kept.length, 1)
  })
})

describe('repeat guard exemptions', () => {
  it('the fixed data list and payment details may always repeat', () => {
    const data = `Para el envío me pasás:\n${SHIPPING_DATA_LIST}`
    assert.equal(dropRepeatedParts({ text: data, previous: [data], customerText: 'Juan Pérez 8888-8888' }).dropped.length, 0)
    const sinpe = 'SINPE Móvil 6201-9914 a nombre de Rafael García'
    assert.equal(dropRepeatedParts({ text: sinpe, previous: [sinpe], customerText: 'a qué número?' }).dropped.length, 0)
  })
})

describe('night disclosure (Rafael 2026-10-17: "Hola, soy Sofi, asistente virtual" at night)', () => {
  it('afterHoursDisclosure is parsed, defaults to "same", survives a save round-trip', () => {
    assert.equal(parseSalesRules({}).afterHoursDisclosure, 'same')
    assert.equal(parseSalesRules({ afterHoursDisclosure: 'transparent' }).afterHoursDisclosure, 'transparent')
    assert.equal(parseSalesRules({ afterHoursDisclosure: 'nope' }).afterHoursDisclosure, 'same')
    assert.equal(parseSalesRules(parseSalesRules({ afterHoursDisclosure: 'transparent', aiDisclosure: 'discreet' })).afterHoursDisclosure, 'transparent')
  })
  it('transparent night: the prompt asks to introduce as the virtual assistant; texts say "asistente virtual"', () => {
    const night = afterHoursState({ enabled: true, timezone: 'America/Costa_Rica', windows: [{ day: 1, open: '08:00', close: '20:00' }], afterHoursNote: null }, new Date('2026-10-20T04:00:00Z'), { aiDisclosure: 'transparent' })
    assert.equal(night.afterHours, true)
    assert.match(afterHoursPromptLine(night) || '', /presentate con tu nombre como asistente virtual/)
    assert.match(afterHoursHandoffLine('person', night.label, true), /asistente virtual/)
    assert.doesNotMatch(afterHoursHandoffLine('person', night.label, true), /autom[aá]tico/)
    const discreet = afterHoursState({ enabled: true, timezone: 'America/Costa_Rica', windows: [{ day: 1, open: '08:00', close: '20:00' }], afterHoursNote: null }, new Date('2026-10-20T04:00:00Z'))
    assert.doesNotMatch(afterHoursPromptLine(discreet) || '', /asistente virtual/)
  })
})

describe('night intro (code-owned "asistente virtual")', () => {
  const N = { afterHours: true, transparent: true }
  const who = { name: 'Sofi', store: 'PatchHouse CR', introduced: false }
  it('rewrites the model self-introduction in place', () => {
    assert.equal(withNightIntro('¡Hola! Soy Sofi de PatchHouse CR 🌿\n\n🧠 Focus trae melena de león.', N, who), '¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌙\n\n🧠 Focus trae melena de león.')
    assert.equal(withNightIntro('Hola, soy Sofi de PatchHouse CR 🌿 Para ansiedad...', N, who), '¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌙\n\nPara ansiedad...')
  })
  it('first message with no greeting: intro first; chat already started: unchanged', () => {
    assert.equal(withNightIntro('🌿 GLP-1 Patch: apoya el control del apetito.', N, who), '¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌙\n\n🌿 GLP-1 Patch: apoya el control del apetito.')
    assert.equal(withNightIntro('🌿 GLP-1 Patch.', N, { ...who, introduced: true }), '🌿 GLP-1 Patch.')
  })
  it('day, discreet, no name or already says it: unchanged', () => {
    assert.equal(withNightIntro('¡Hola! Soy Sofi de PatchHouse CR 🌿', { afterHours: false, transparent: true }, who), '¡Hola! Soy Sofi de PatchHouse CR 🌿')
    assert.equal(withNightIntro('¡Hola! Soy Sofi de PatchHouse CR 🌿', { afterHours: true, transparent: false }, who), '¡Hola! Soy Sofi de PatchHouse CR 🌿')
    assert.equal(withNightIntro('x', N, { ...who, name: '' }), 'x')
    assert.equal(withNightIntro('¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌿 Hola', N, who), '¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌿 Hola')
  })
  it('a person hand-off at night never says when the team writes twice', () => {
    const night = afterHoursState({ enabled: true, timezone: 'America/Costa_Rica', windows: [{ day: 6, open: '08:00', close: '20:00' }], afterHoursNote: null }, new Date('2026-10-17T07:30:00Z'), { aiDisclosure: 'transparent' })
    const text = applyAfterHoursText({ text: `¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌿 El equipo te atiende ${night.label}`, handoff: { kind: 'handoff', reason: 'human_request' } }, night, { safeReview: 'Dame un momento y te confirmo 😊' })
    assert.equal(text.split(night.label.replace(/\.$/, '')).length - 1, 1, text)
  })
})

describe('SQL 054 (luna-only model)', () => {
  it('data + default only, never touches live agents, registered', () => {
    const sql = fs.readFileSync('supabase/migrations/054_luna_only_model.sql', 'utf8')
    const code = sql.replace(/--[^\n]*/g, '')
    assert.match(code, /ALTER TABLE public\."ChatAgent" ALTER COLUMN "model" SET DEFAULT 'gpt-6-luna'/)
    assert.match(code, /WHERE "model" <> 'gpt-6-luna' AND "status" <> 'live'/)
    assert.doesNotMatch(code, /DROP |TRUNCATE|DELETE FROM|CREATE TABLE|ADD COLUMN/i)
    assert.match(fs.readFileSync('scripts/lib/betsy-v2-additive-manifest.mjs', 'utf8'), /'054': '054_luna_only_model\.sql'/)
    assert.match(fs.readFileSync('prisma/schema.prisma', 'utf8'), /model\s+String\s+@default\("gpt-6-luna"\)/)
  })
})

describe('verifier round 1 (luna-10)', () => {
  const N = { afterHours: true, transparent: true }
  const who = { name: 'Sofi', store: 'PatchHouse CR', introduced: false }
  it('F1: the night intro never cuts a reply that is more than an intro', () => {
    assert.equal(withNightIntro('Hola, soy Sofi y el Stress Down cuesta ₡12.000 😊', N, who), 'Hola, soy Sofi y el Stress Down cuesta ₡12.000 😊')
    assert.equal(withNightIntro('¡Hola! Soy Sofi de PatchHouse CR, ¿te ayudo con algo?', N, who), '¡Hola! Soy Sofi de PatchHouse CR, ¿te ayudo con algo?')
    assert.equal(withNightIntro('¡Hola! Soy Sofi de PatchHouse CR 🌿 El Focus cuesta ₡9 900.', N, who), '¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌙\n\nEl Focus cuesta ₡9 900.')
  })
  it('F2: a different price / place / amount is never a repeat; a long list does not swallow a new answer', () => {
    assert.equal(isNearRepeat('El envío a San José cuesta ₡2.500 y llega en 2 días hábiles', ['El envío a Alajuela cuesta ₡3.500 y llega en 3 días hábiles']), false)
    assert.equal(isNearRepeat('El combo de 3 cuesta ₡30.000 más envío', ['El combo de 2 cuesta ₡22.000 más envío']), false)
    assert.equal(isNearRepeat('El Sleep Well apoya el descanso y viene con 30 parches', ['Tenemos Focus, Energy, Stress Relief, Dopamine, GLP-1 y Sleep Well: el Sleep Well apoya el descanso, el Focus la concentración y el Energy la energía']), false)
  })
  it('F5: order / price sentences are not results promises; real promises still are', () => {
    for (const t of ['Con el combo vas a ver la diferencia en el precio', 'Muchas clientas notan que les llega rápido el pedido', 'Podés ver el resultado del pedido en la página', 'Envío garantizado a todo el país']) assert.equal(resultsClaimIn(t), null, t)
    for (const t of ['Muchas personas nos cuentan que duermen mejor', 'Te garantizo que funciona', 'Garantizamos resultados']) assert.ok(resultsClaimIn(t), t)
  })
  it('F7: after an opt-out the team is alerted but the customer gets no automatic text', () => {
    const base = { lastTurn: { id: 't', handoffKind: 'handoff', completedAt: new Date('2026-10-17T17:50:00Z') }, humanWroteSince: false, lineOn: true, alreadyAcked: false, now: new Date('2026-10-17T18:00:00Z') }
    assert.deepEqual(decideWaitingAck({ ...base, optOut: true }), { ack: false, realert: true, reason: 'opt_out' })
    for (const t of ['STOP', 'no quiero hablar con un bot', 'no me escriban más', 'basta ya']) assert.ok(isOptOutText(t), t)
    for (const t of ['Me podría atender un asesor', 'quiero hablar con una persona', 'no quiero el combo']) assert.equal(isOptOutText(t), false, t)
  })
  it('F3 / F4 / F6 / F8 / F9 (source): kill switch, platform pause and AI terms gate the ack; the turn row holds the sent text; the sweep skips the ack; images only stop when everything was dropped; early exit', () => {
    const turn = fs.readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    const ack = turn.slice(turn.indexOf('async function ackWaitingCustomer'), turn.indexOf('Daily token caps sum turns'))
    assert.match(ack, /!\(await readAgentKillState\(row\.tenantId\)\)\.armed/)
    assert.match(ack, /!\(await isPlatformAiPaused\(\)\)/)
    assert.match(ack, /await isAiTermsAcceptedNow\(row\.tenantId\)/)
    assert.ok(ack.indexOf("if (!lastTurn || handoffKind !== 'handoff') return") < ack.indexOf('resolveChatAgent('))
    assert.match(turn, /if \(outgoingText !== input\.outputText\) \{\s*await prisma\.chatAgentTurn\.update\(\{\s*where: \{ id: input\.turnId \},\s*data: \{ outputText: outgoingText, outputHash: hashSoftAiOutput\(outgoingText\) \}/)
    assert.match(turn, /input\.replyAssets\?\.size && !repeatAllDropped\)/)
    assert.match(fs.readFileSync('src/lib/soft-ai/waiting-sweep.ts', 'utf8'), /\.find\(\(r\) => \(r\.metadata as \{ waitingAck\?: unknown \} \| null\)\?\.waitingAck !== true\)/)
  })
})
