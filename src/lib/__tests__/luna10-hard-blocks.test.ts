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
  it('line off / kill switch: the team is still alerted, the customer gets nothing; hand-off older than 24 h: silent', () => {
    assert.deepEqual(decideWaitingAck({ ...base, lineOn: false }), { ack: false, realert: true, reason: 'line_off' })
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
    assert.equal(withNightIntro('¡Hola! Soy Sofi de PatchHouse CR 🌿\n\n🧠 Focus trae melena de león.', N, who), '¡Hola! Soy Sofi, asistente virtual de PatchHouse CR 🌿\n\n🧠 Focus trae melena de león.')
    assert.equal(withNightIntro('Hola, soy Sofi de PatchHouse CR 🌿 Para ansiedad...', N, who), 'Hola, soy Sofi, asistente virtual de PatchHouse CR 🌿 Para ansiedad...')
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
  it('F1 (rounds 1+2): the night intro never cuts or replaces a word — it only inserts ", asistente virtual"', () => {
    assert.equal(withNightIntro('Hola, soy Sofi y el Stress Down cuesta ₡12.000 😊', N, who), 'Hola, soy Sofi, asistente virtual, y el Stress Down cuesta ₡12.000 😊')
    assert.equal(withNightIntro('¡Hola! Soy Sofi de PatchHouse CR, ¿te ayudo con algo?', N, who), '¡Hola! Soy Sofi, asistente virtual de PatchHouse CR, ¿te ayudo con algo?')
    assert.equal(withNightIntro('Hola, soy Sofi y sí tenemos envíos a todo el país 🚚', N, who), 'Hola, soy Sofi, asistente virtual, y sí tenemos envíos a todo el país 🚚')
    assert.equal(withNightIntro('Hola, soy Sofi y no tenemos el Focus en este momento.', N, who), 'Hola, soy Sofi, asistente virtual, y no tenemos el Focus en este momento.')
    assert.equal(withNightIntro('Hola 👋 Soy Sofi. ¿En qué te ayudo?', N, who), 'Hola 👋 Soy Sofi, asistente virtual. ¿En qué te ayudo?')
    assert.equal(withNightIntro('¡Hola! Soy José de PatchHouse S.A. ¿En qué te ayudo?', N, { name: 'José', store: 'PatchHouse S.A.', introduced: false }), '¡Hola! Soy José, asistente virtual de PatchHouse S.A. ¿En qué te ayudo?')
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

describe('SecureDog round 1 (luna-10)', () => {
  it('waiting ack: line health + kill re-check right before the send; one "sigue esperando" alert per 15 min', () => {
    const turn = fs.readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    const ack = turn.slice(turn.indexOf('async function ackWaitingCustomer'), turn.indexOf('Daily token caps sum turns'))
    assert.match(ack, /account\.isActive !== false && !account\.disconnectedAt && tokenStatus !== 'revoked' && tokenStatus !== 'expired'/)
    assert.ok(ack.indexOf('(await readAgentKillState(row.tenantId)).armed || (await isPlatformAiPaused())') < ack.indexOf('const ackDelivery = await deliverOnce('))
    assert.match(ack, /createdAt: \{ gte: new Date\(Date\.now\(\) - WAITING_ALERT_THROTTLE_MS\) \}/)
  })
  it('Pegar cliente stops on the platform AI pause', () => {
    assert.match(fs.readFileSync('src/app/api/ventas/customer-paste/enhance/route.ts', 'utf8'), /if \(await isPlatformAiPaused\(\)\) return NextResponse\.json/)
  })
  it('exam / shoppers / shadow only run through the safe test session (terms, kill, actor, audited cap, signals)', () => {
    const session = fs.readFileSync('scripts/agent-pack/test-session.ts', 'utf8')
    for (const re of [/isAiTermsAcceptedNow\(tenantId\)/, /readAgentKillState\(tenantId\)\)\.armed/, /isPlatformAiPaused\(\)/, /\['OWNER', 'ADMIN'\]/, /logAudit\(/, /process\.once\('SIGINT'/, /process\.once\('SIGTERM'/]) assert.match(session, re)
    for (const f of ['exam', 'shoppers', 'shadow']) {
      const src = fs.readFileSync(`scripts/agent-pack/${f}.ts`, 'utf8')
      assert.match(src, /withExamSession\(/, f)
      assert.doesNotMatch(src, /mutateChatAgentLayerConfig/, f)
    }
  })
  it('the bank / reviewer redaction removes accented names, dotted numbers, @handles and keeps prices', async () => {
    const { redactCustomerText } = await import('../../../scripts/agent-pack/exam-bank')
    assert.equal(redactCustomerText('Hola soy José Ramírez, quiero info', 'José Ramírez'), 'Hola soy [nombre] [nombre], quiero info')
    assert.equal(redactCustomerText('me llamo maria fernanda rodriguez'), 'me llamo [nombre] ')
    assert.equal(redactCustomerText('cédula 1.1234.0567 y cel 8888.8888'), 'cédula [número] y cel [número]')
    assert.equal(redactCustomerText('búscame en @ana.perez_cr'), 'búscame en [usuario]')
    assert.equal(redactCustomerText('El Focus cuesta ₡9 900'), 'El Focus cuesta ₡9 900')
    assert.equal(redactCustomerText('soy de Cartago'), 'soy de Cartago')
  })
  it('accented introduction names never get a second greeting', () => {
    const N = { afterHours: true, transparent: true }
    assert.equal(withNightIntro('¡Hola! Soy José de La Tienda 🌿 El Focus cuesta ₡9 900.', N, { name: 'José', store: 'La Tienda', introduced: false }), '¡Hola! Soy José, asistente virtual de La Tienda 🌿 El Focus cuesta ₡9 900.')
    assert.equal(withNightIntro('¡Hola! Soy Ángela de La Tienda, ¿en qué te ayudo?', N, { name: 'Ángela', store: 'La Tienda', introduced: false }), '¡Hola! Soy Ángela, asistente virtual de La Tienda, ¿en qué te ayudo?')
  })
})

describe('verifier + SecureDog round 2 (luna-10)', () => {
  it('#3: guarantees in any word order and time-to-effect promises are caught; store sentences pass', () => {
    for (const t of ['Resultado garantizado', 'Efecto garantizado 💯', 'Te garantizo resultados', 'Funciona garantizado', 'Garantizado: vas a dormir mejor', 'Resultados garantizados', 'vas a sentir más energía desde el primer día', 'te va a quitar la ansiedad', 'en una semana ves resultados', 'Te quita el estrés', 'Te ayuda a dormir mejor desde la primera noche']) assert.ok(resultsClaimIn(t), t)
    for (const t of ['Muchas personas dicen que es el mejor precio del país', 'Muchas clientas notan que el envío es rápido y el precio es mejor', 'Pago seguro garantizado', 'El Energy da energía sostenida hasta por 8 horas', 'Se usa uno al día desde el primer día que lo recibís']) assert.equal(resultsClaimIn(t), null, t)
  })
  it('#4: every "don\'t contact me" is an opt-out, asking for a person is not', () => {
    for (const t of ['STOP', 'no me escriban más', 'NO MÁS MENSAJES', 'ya no me manden nada', 'quiero darme de baja', 'no me contacten más', 'No quiero un asistente virtual', 'No quiero que me atienda una inteligencia artificial', 'No me escriban']) assert.ok(isOptOutText(t), t)
    for (const t of ['Me podría atender un asesor', 'quiero hablar con una persona', 'no quiero el combo', 'no me llegó el pedido']) assert.equal(isOptOutText(t), false, t)
    assert.match(fs.readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8'), /optOut: isOptOutText\(handoffTrigger\?\.content\) \|\| isOptOutText\(input\.payload\.content\)/)
  })
  it('#5: a new place / product the customer asked about is a new answer; the same answer twice is still dropped', () => {
    assert.equal(isNearRepeat('El envío a Limón cuesta ₡2.500 y llega en 2 días hábiles', ['El envío a San José cuesta ₡2.500 y llega en 2 días hábiles'], 'y a limón?'), false)
    assert.equal(isNearRepeat('Sí, el Focus está disponible y lo enviamos hoy mismo', ['Sí, el Stress Down está disponible y lo enviamos hoy mismo'], 'y el focus?'), false)
    assert.equal(isNearRepeat('El envío a San José cuesta ₡2.500 y llega en 2 días hábiles', ['El envío a San José cuesta ₡2.500 y llega en 2 días hábiles'], 'cuanto el envio?'), true)
  })
  it('#1: the waiting ack never counts as an answer for the sweep or the re-arm (Devolver a IA answers the message)', () => {
    assert.match(fs.readFileSync('src/lib/soft-ai/waiting-sweep.ts', 'utf8'), /_count: \{ select: \{ deliveries: \{ where: \{ NOT: \{ deliveryKey: \{ endsWith: ':waiting_ack' \} \} \} \} \} \}/)
    assert.match(fs.readFileSync('src/lib/soft-ai/automation-queue.ts', 'utf8'), /deliveries: \{ none: \{ NOT: \{ deliveryKey: \{ endsWith: ':waiting_ack' \} \} \} \}/)
    assert.match(fs.readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8'), /deliveryKey: `\$\{row\.deliveryKey\}:waiting_ack`/)
  })
  it('SecureDog L2/L4: shadow replays redacted text as "Cliente"; the test cap is bounded and only our own raise is undone', () => {
    const shadow = fs.readFileSync('scripts/agent-pack/shadow.ts', 'utf8')
    assert.match(shadow, /customerName: 'Cliente',/)
    assert.match(shadow, /agent: redactCustomerText\(r\.text, c\.peerName\)/)
    const session = fs.readFileSync('scripts/agent-pack/test-session.ts', 'utf8')
    assert.match(session, /input\.cap > 20_000_000/)
    assert.match(session, /c\.testDailyTokenCap === input\.cap \? \{ \.\.\.c, testDailyTokenCap: before \} : c/)
  })
})

describe('verifier round 3 (luna-10): probes', () => {
  it('all reviewer probes hold (sales text passes, promises caught, opt-outs, repeat, night intro)', async () => {
    const bad: string[] = []
    const fp = ['Llevando 3 vas a tener mejor precio', 'Con el combo vas a tener mejor precio por unidad', 'En 3 días hábiles lo vas a ver en tu casa', 'En una semana vas a ver el paquete', 'Muchas personas dicen que es el mejor precio del país', 'Envío garantizado a todo el país', 'Llega en 2 a 5 días hábiles', 'Se usa uno al día desde el primer día que lo recibís', 'El GLP-1 apoya el control del apetito y ayuda a reducir antojos', 'No es un medicamento y no promete bajar de peso', 'En 2 días lo tenés en tu casa']
    const tp = ['a la semana notás el cambio', 'en 7 días ves resultados', 'a los pocos días notás la diferencia', 'Sin duda vas a sentir más calma', 'No te preocupes, te va a quitar la ansiedad', '¡Claro! No te preocupes, resultado garantizado', 'Resultado garantizado', 'Te garantizo resultados', 'vas a sentir más energía desde el primer día', 'te vas a sentir más tranquila', 'Muchas personas notan cambios en los primeros días', 'en una semana ves resultados', 'te ayuda a dormir mejor desde la primera noche', 'Con el GLP-1 vas a bajar de peso']
    for (const t of fp) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t)
    for (const t of tp) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    for (const t of ['No me escribas más', 'no me vuelvan a escribir', 'Ya no quiero mensajes', 'no quiero recibir más mensajes', 'déjenme en paz', 'STOP', 'no me escriban más', 'No me escriban', 'no me escriban por favor', 'No quiero un asistente virtual', 'quiero darme de baja']) if (!isOptOutText(t)) bad.push('OPTOUT MISSED ' + t)
    for (const t of ['No me manden el catálogo todavía', 'no me contesten así', 'no me escriba al otro número', 'quiero hablar con una persona', 'no me llegó el pedido']) if (isOptOutText(t)) bad.push('OPTOUT FALSE+ ' + t)
    if (isNearRepeat('El envío a Limón cuesta ₡2.500 y llega en 2 días hábiles', ['El envío a San José cuesta ₡2.500 y llega en 2 días hábiles'], 'y a Limón\ncuánto sale?')) bad.push('REPEAT limón 2 msgs dropped')
    if (isNearRepeat('El envío a Osa cuesta ₡2.500 y llega en 2 días hábiles', ['El envío a San José cuesta ₡2.500 y llega en 2 días hábiles'], 'y a Osa?')) bad.push('REPEAT osa dropped')
    if (!isNearRepeat('El envío a San José cuesta ₡2.500 y llega en 2 días hábiles', ['El envío a San José cuesta ₡2.500 y llega en 2 días hábiles'], 'cuanto sale?')) bad.push('REPEAT same not dropped')
    const N = { afterHours: true, transparent: true }, w = { name: 'Sofi', store: 'PatchHouse CR', introduced: false }
    const ni = [['¡Hola! Soy Sofi\n\nEl Focus cuesta ₡9 900.', '¡Hola! Soy Sofi, asistente virtual\n\nEl Focus cuesta ₡9 900.'], ['¡Hola! 👋\nSoy Sofi de PatchHouse CR. ¿Qué buscás?', '¡Hola! 👋\nSoy Sofi, asistente virtual de PatchHouse CR. ¿Qué buscás?'], ['Hola, te escribe Sofi de PatchHouse CR 😊', 'Hola, te escribe Sofi, asistente virtual de PatchHouse CR 😊'], ['Hola, soy Sofi y sí tenemos envíos 🚚', 'Hola, soy Sofi, asistente virtual, y sí tenemos envíos 🚚']]
    for (const [i, o] of ni) { const r = withNightIntro(i, N, w); if (r !== o) bad.push('INTRO ' + JSON.stringify(r)) }
    assert.deepEqual(bad, [])
  })
})

describe('exam round 1 fixes (luna-10)', () => {
  it('payment questions reach the agent; every receipt / claim still goes to a person', async () => {
    const { classifyPaymentText } = await import('../soft-ai/payment-classifier')
    assert.equal(classifyPaymentText('Hola, necesito comprar unos parches de glp-1, puedo hacerles un sinpe y mandar un flash a recogerlos?'), 'non_payment')
    assert.equal(classifyPaymentText('Muchas gracias \nTienes link de pago? Para la ansiedad cuáles me \nRecomiendas?'), 'payment_info_safe')
    for (const t of ['te mandé el comprobante', 'ya pagué', '¿Ya les llegó mi sinpe?', '¿Ya les hice el sinpe?', 'les mandé el sinpe ahora', 'puedo mandarles el comprobante?', 'Ya te puedo mandar el sinpe, ¿me confirmás?', 'te envié la transferencia, ¿podés revisar?', 'hice un sinpe de 15 mil']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('[[DATOS_PAGO]]: method names + "¿Cómo preferís pagar?" unless the customer asked for the details', async () => {
    const { fillPaymentToken } = await import('../soft-ai/payment-guard')
    const facts: any = { schemaVersion: 1, payment: { shareWithCustomers: true, methods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' }, transfer: { bank: 'BAC', iban: 'CR12010200009506464063', holderName: 'Rafael Alberto García Montoya' } } }
    for (const c of ['Se puede pagar con tarjeta?', '¿Cómo puedo pagar?']) {
      const r = fillPaymentToken('Claro 😊 [[DATOS_PAGO]]', facts, { customerText: c })
      assert.equal(r.text, 'Claro 😊 Tenemos SINPE Móvil, transferencia, tarjeta y contra entrega. ¿Cómo preferís pagar?', c)
      assert.doesNotMatch(r.text, /6201|CR12/)
    }
    for (const c of ['Pasame los datos de pago por favor', '¿A qué número hago el sinpe?', 'me das la cuenta?']) {
      assert.match(fillPaymentToken('[[DATOS_PAGO]]', facts, { customerText: c }).text, /6201 9914/, c)
    }
  })
  it('health questions are answered (doctor) without a hand-off; coverage "no sé" check ignores "no se recomienda"', async () => {
    assert.match(fs.readFileSync('src/lib/soft-ai/llm/tool-definitions.ts', 'utf8'), /Salud \(embarazo, lactancia, una condición, medicamentos\): respondé con tus datos y que consulte a su médico, sin escalar/)
    const { coverageScenarios } = await import('../soft-ai/knowledge-coverage')
    const re = new RegExp(coverageScenarios(['Focus'])[0].steps[0].expect!.forbidRegex![1], 'iu')
    assert.equal(re.test('Por precaución, no se recomienda usarlo durante el embarazo'), false)
    assert.equal(re.test('Uy, no sé cuántos trae'), true)
  })
})

describe('verifier round 4 (luna-10): payment chain probes', () => {
  it('names reply is the method question; choices, details, receipts and promises behave', async () => {
    const { fillPaymentToken } = await import('../soft-ai/payment-guard')
    const { classifyPaymentText } = await import('../soft-ai/payment-classifier')
    const { PAYMENT_METHOD_ASKED_RE } = await import('../soft-ai/sales-state')
    const facts: any = { schemaVersion: 1, payment: { shareWithCustomers: true, methods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' }, transfer: { bank: 'BAC', iban: 'CR12010200009506464063', holderName: 'X' } } }
    const bad: string[] = []
    const q = fillPaymentToken('[[DATOS_PAGO]]', facts, { customerText: '¿Cómo puedo pagar?' }).text
    if (!PAYMENT_METHOD_ASKED_RE.test(q)) bad.push('names reply not a method question: ' + q)
    for (const a of ['SINPE', 'Por sinpe', 'Por SINPE está bien']) { const c = classifyPaymentText(a, { awaitingPaymentMethod: true }); if (c !== 'non_payment') bad.push(`choice "${a}" → ${c}`) }
    for (const c of ['Me pasás el SINPE?', 'Pasame el SINPE', '¿Cuál es el sinpe?', '¿Dónde les deposito?', 'Dame la info para pagar', 'pasame los datos\ngracias']) if (!/6201/.test(fillPaymentToken('[[DATOS_PAGO]]', facts, { customerText: c }).text)) bad.push('details not given: ' + c)
    if (!/6201/.test(fillPaymentToken('[[DATOS_PAGO]]', facts, { customerText: 'ok', chosenMethod: 'sinpe' }).text)) bad.push('chosen method ignored')
    for (const t of ['¿Les puedo mandar el sinpe por acá?', 'ya les puedo enviar el sinpe?', 'puedo mandarles el sinpe de la otra vez?', 'Ya usé el link de pago', 'Me rebotó el link de pago', 'El link de pago no me funciona']) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`must stay person: "${t}" → ${c}`) }
    for (const t of ['Hola, necesito comprar unos parches, puedo hacerles un sinpe y mandar un flash?', '¿Tienes link de pago?', '¿Me pasás el link de pago?']) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`question went to person: "${t}"`) }
    for (const t of ['No es medicamento pero vas a sentir más energía', 'no tiene químicos y vas a sentir más energía']) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    if (resultsClaimIn('te vas a sentir mejor atendida con nosotros')) bad.push('FALSE+ atendida')
    console.log(bad.length ? bad.join('\n') : 'ALL OK')
    assert.deepEqual(bad, [])
  })
})

describe('SecureDog round 3 (luna-10): INT-136..139', () => {
  it('payment questions vs claims / refunds / link status (31 probes)', async () => {
    const { classifyPaymentText } = await import('../soft-ai/payment-classifier')
    const person = ['¿Puedo hacerles un sinpe? Ya lo envié', '¿Puedo hacerles un sinpe? ya se lo mandé', 'puedo hacerle un sinpe? ya está hecho', '¿Se puede hacer un sinpe? ya lo realicé', '¿Puedo hacerte un sinpe? lo mandamos hoy', '¿Podría hacerle un sinpe? lo envié desde la cuenta de mi mamá', '¿Pueden hacer un sinpe a mi cuenta? el producto llegó dañado', '¿Me pueden hacer un sinpe con lo que sobró?', '¿Se puede hacer un sinpe de vuelta? no me quedó la talla', 'Ya usé el link de pago', 'Ya completé el link de pago', 'El link de pago ya lo usé', 'Tienes link de pago? ya lo usé', 'Me rebotó el link de pago', 'El link de pago no me funciona', 'contra entrega? el sinpe salió ayer', 'El depósito ya está', '¿Les puedo mandar el sinpe por acá?', 'ya les puedo enviar el sinpe?', 'te mandé el comprobante', 'ya pagué', '¿Ya les llegó mi sinpe?', 'hice un sinpe de 15 mil']
    const agent = ['Hola, necesito comprar unos parches de glp-1, puedo hacerles un sinpe y mandar un flash a recogerlos?', '¿Tienes link de pago?', '¿Me pasás el link de pago?', '¿Puedo hacerles una transferencia?', '¿Cómo puedo pagar?', 'Se puede pagar con tarjeta?', '¿Hacen contra entrega en Cartago?', 'Puedo pagar contra entrega?']
    const bad: string[] = []
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    console.log(bad.length ? bad.join('\n') : `ALL OK (${person.length} person, ${agent.length} agent)`)
    assert.deepEqual(bad, [])
  })
  it('INT-138: safety assurances are held; doctor advice passes', () => {
    const bad: string[] = []
    for (const t of ['Es seguro en el embarazo 😊', 'Son 100% seguros para niños', 'No tiene efectos secundarios', 'no causa ningún riesgo', 'Podés usarlo durante la lactancia sin problema']) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    for (const t of ['Durante el embarazo, consultá con tu médico antes de usarlo', 'Con piel sensible puede haber enrojecimiento; si pasa, retiralo', 'Es un suplemento de bienestar, no un medicamento.', 'El pago es seguro con tarjeta', 'El envío es seguro y llega en 2 a 5 días']) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t)
    assert.deepEqual(bad, [])
    assert.match(fs.readFileSync('src/lib/soft-ai/llm/tool-definitions.ts', 'utf8'), /por ejemplo: dolor de pecho/)
  })
})

describe('verifier round 5 (luna-10): link questions, chosen method, safety wording', () => {
  it('every way to ask for the link reaches the agent; claims next to it still go to a person', async () => {
    const { classifyPaymentText } = await import('../soft-ai/payment-classifier')
    const bad: string[] = []
    for (const t of ['Quiero comprar los 2 . Me envías el link de pago', 'pasame el link de pago', 'Link de pago?', '¿Ya puedo hacerles el sinpe?', 'me podés pasar el link de pago?', 'quiero el link de pago', '¿Cómo pagamos?']) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`question went to person: "${t}"`) }
    for (const t of ['Me pasás el link de pago? ya lo pagamos', 'pasame el link de pago, ya transferimos', 'Me envías el link de pago? me cobró doble', '¿Puedo hacerles el sinpe? ya lo hice', 'Tienes link de pago? ya lo usé', '¿Puedo hacerte un sinpe? lo mandamos hoy',
      // SecureDog r4: anything after the closing "?" (other than one more question), or "listo" anywhere → a person.
      '¿tienen link de pago? Compramos en familia', 'Ya tengo todo listo, mandame el link de pago']) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`must stay person: "${t}" → ${c}`) }
    assert.deepEqual(bad, [])
  })
  it('[[DATOS_PAGO]] after a chosen method gives only that method', async () => {
    const { fillPaymentToken } = await import('../soft-ai/payment-guard')
    const facts: any = { schemaVersion: 1, payment: { shareWithCustomers: true, methods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' }, transfer: { bank: 'BAC', iban: 'CR12010200009506464063', holderName: 'X' } } }
    const r = fillPaymentToken('[[DATOS_PAGO]]', facts, { customerText: 'por sinpe', chosenMethod: 'sinpe' })
    assert.match(r.text, /6201/)
    assert.doesNotMatch(r.text, /CR12/)
    assert.deepEqual(r.methods, ['sinpe'])
  })
  it('"no tiene riesgo" is not a health assurance; "no tiene efectos secundarios" still is', () => {
    assert.equal(resultsClaimIn('El pago con tarjeta no tiene ningún riesgo'), null)
    assert.ok(resultsClaimIn('No tiene efectos secundarios'))
  })
})

describe('SecureDog round 4 (luna-10): INT-136 tails, INT-140 "ya pagamos", INT-138 wording, PAYMENT_RE end', () => {
  it('claims after the question, plural / third-person payments → a person; questions still reach the agent', async () => {
    const { classifyPaymentText, hasPaymentWord } = await import('../soft-ai/payment-classifier')
    const bad: string[] = []
    for (const t of ['¿Puedo hacerles un sinpe? hecho', '¿Puedo hacerles un sinpe? listo', '¿Puedo hacerles un sinpe? Mamá lo canceló', '¿Puedo hacerles un sinpe? Juan lo realizó', '¿Puedo hacerles un sinpe? Lo efectué', '¿Puedo hacerles un sinpe? Lo hicieron ellos', '¿Puedo hacerles un sinpe? va en camino', '¿Puedo hacerles un sinpe? ia esta', '¿Puedo hacerles un sinpe? already sent', '¿Puedo hacerles un sinpe? done', '¿Puedo hacerles un depósito? lo hicieron en el BCR', '¿puedo hacerles un sinpe?✅', 'Tienes link de pago? el otro no me sirvió', 'Tienes link de pago? no me cargó', 'Tienes link de pago? me rechazó la tarjeta', 'Ya pagamos', 'ya lo pagamos', 'Ya pagaron', 'ya cancelamos', 'ya depositamos', 'lo pagamos ayer', 'Les pagaré el resto mañana, el adelanto ya está']) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`must stay person: "${t}" → ${c}`) }
    for (const t of ['Hola, necesito comprar unos parches de glp-1, puedo hacerles un sinpe y mandar un flash a recogerlos?', 'Muchas gracias \nTienes link de pago? Para la ansiedad cuáles me \nRecomiendas?', '¿Cómo pagamos?', 'Link de pago?']) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`question went to person: "${t}"`) }
    for (const t of ['pagaré', 'pagaría', 'Ya pagamos']) if (!hasPaymentWord(t)) bad.push('no payment word: ' + t)
    assert.deepEqual(bad, [])
  })
  it('INT-138: more safety-assurance wordings are held; the voseo "no te preocupés" is not a negation', () => {
    const bad: string[] = []
    for (const t of ['Es seguro usarlo durante el embarazo', 'lo podés usar en el embarazo sin problema', 'Sin efectos secundarios', 'Es apto para embarazadas', 'Es seguro para tu bebé', 'Es seguro tomarlo con tus medicamentos', 'Sin dudas es seguro en el embarazo', 'No te preocupés que es seguro para niños']) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    for (const t of ['Si tomás medicamentos, consultá con tu médico', 'Es seguro pagar con tarjeta en la web', 'El pago con tarjeta no tiene ningún riesgo']) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t)
    assert.deepEqual(bad, [])
  })
})

describe("verifier round 6 (luna-10): allowlist question shapes, no COD narrowing, riesgo wording, abonar / rechazo", () => {
  it("every round-6 repro holds; the real questions still reach the agent", async () => {
    const { classifyPaymentText } = await import("../soft-ai/payment-classifier")
    const { fillPaymentToken } = await import("../soft-ai/payment-guard")
    const person = ['El link de pago venció, ¿me mandás otro?', 'El link de pago lo usó mi esposo, ¿me lo mandás de nuevo?', 'El link de pago no sirve?', 'El link de pago expiró?', 'El enlace de pago está caído?', 'Link de pago caducado?', 'El link de pago venció. ¿Puedo hacerles el sinpe?',
     'Mi mamá lo canceló, mandame el link de pago', 'El otro link no sirvió, pasame el link de pago', 'Abonamos la mitad el lunes, pasame el link de pago', 'Le sinpeamos 10 mil para el adelanto, mandame el link de pago', 'Mi esposo canceló la mitad por sinpe. ¿Me pasás el link de pago?', 'Mamá lo canceló. ¿Puedo hacerles el sinpe del resto?', 'Abonaron la mitad. ¿Puedo hacerles el sinpe del resto?', 'El link no sirvió. ¿Puedo hacerles un sinpe?',
     '¿Me pasás el link de pago? Mi mamá lo canceló?', 'Tienes link de pago? mi esposo lo abonó?', 'Tienes link de pago? el otro no me sirvió?', '¿Me pasás el link de pago? ¿el que me mandaste venció?', '¿Me pasás el link de pago? el otro link expiró?',
     '¿Puedo hacerles la transferencia otra vez? la anterior me la rechazaron', 'Me rechazaron la tarjeta. ¿Puedo hacerles el sinpe?', 'El link de pago me declinó la tarjeta, ¿qué hago?', 'Ya les abonamos la mitad. ¿Cómo pagamos el resto?', 'Ya aboné la mitad, ¿cómo pago el resto?',
     'Link de pago vencido', 'Me pasás el link de pago? lo cancelamos por sinpe', 'pasame el link de pago, le sinpeamos la mitad',
     '¿Puedo hacerles un sinpe? hecho', '¿Puedo hacerles un sinpe? Mamá lo canceló', '¿Puedo hacerles un sinpe? already sent', 'Ya pagamos', 'Ya pagaron', 'Tienes link de pago? ya lo usé', 'Me rebotó el link de pago', 'Tienes link de pago? me rechazó la tarjeta', '¿tienen link de pago? Compramos en familia', 'Ya tengo todo listo, mandame el link de pago']
    const agent = ['Hola, necesito comprar unos parches de glp-1, puedo hacerles un sinpe y mandar un flash a recogerlos?', '¿Tienes link de pago?', '¿Me pasás el link de pago?', 'Quiero comprar los 2 . Me envías el link de pago', 'pasame el link de pago', 'Link de pago?', '¿Ya puedo hacerles el sinpe?', 'me podés pasar el link de pago?', 'quiero el link de pago', 'Muchas gracias \nTienes link de pago? Para la ansiedad cuáles me \nRecomiendas?', '¿Cómo pagamos?', '¿Cómo puedo pagar?', '¿Puedo hacerles una transferencia?', 'Hola buenas 😊 ¿puedo hacerles un sinpe?', 'Hola! Me pasás el link de pago porfa 🙏', '¿Hacen contra entrega en Cartago?']
    const bad: string[] = []
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    for (const t of ['Es natural, no tiene ningún riesgo en el embarazo', 'No tienen riesgos para la salud', 'Tranquila, no tiene ningún riesgo para vos', 'Sin riesgo para tu bebé', 'No hay riesgo para tu bebé', 'Es seguro usarlo durante el embarazo', 'Sin efectos secundarios']) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    for (const t of ['El pago con tarjeta no tiene ningún riesgo', 'Es seguro pagar con tarjeta en la web', 'Durante el embarazo, consultá con tu médico antes de usarlo']) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t)
    const facts: any = { schemaVersion: 1, payment: { shareWithCustomers: true, methods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'R G' }, transfer: { bank: 'BAC', iban: 'CR12010200009506464063', holderName: 'X' } } }
    const cod = fillPaymentToken('Claro 🙌 [[DATOS_PAGO]]', facts, { customerText: '¿me pasás los datos para pagar?', chosenMethod: 'contra_entrega' })
    if (cod.methods.includes('contra_entrega' as any)) bad.push('COD narrowed: ' + JSON.stringify(cod))
    const other = fillPaymentToken('[[DATOS_PAGO]]', facts, { customerText: '¿y si pago por sinpe, a qué número sería?', chosenMethod: 'transferencia' })
    if (!/6201/.test(other.text)) bad.push('other method not given: ' + other.text)
    const sinpe = fillPaymentToken('[[DATOS_PAGO]]', facts, { customerText: 'por sinpe', chosenMethod: 'sinpe' })
    if (!/6201/.test(sinpe.text) || /CR12/.test(sinpe.text)) bad.push('chosen sinpe wrong: ' + sinpe.text)
    
    assert.deepEqual(bad, [])
  })
})

describe("SecureDog round 5 + verifier round 7 (luna-10): plain-ask gate on every exit, INT-140 forms, health sentence rule", () => {
  it("claims behind info / COD / how-to-pay questions go to a person; everyday asks reach the agent", async () => {
    const { classifyPaymentText, hasPaymentWord } = await import("../soft-ai/payment-classifier")
    const person = ['¿Puedo hacerles una transferencia? hecho', '¿Puedo hacerles una transferencia? Mamá la realizó', '¿Puedo hacerles un sinpe móvil? hecho', '¿Puedo pagar con tarjeta? listo, ya la pasé', '¿Aceptan transferencia? la realizó mi esposo', '¿Cuál es el número de sinpe? Mamá lo canceló', 'Mi mamá realizó la transferencia', 'Ya realizamos la transferencia', 'La transferencia ya la hicimos', 'La transferencia ya está', 'Mi esposo canceló con tarjeta', '¿Hacen contra entrega? Mamá lo canceló', '¿Puedo pagar con sinpe? Mamá lo canceló', '¿Cuándo se paga? Ya les pasaron la plata', '¿Con qué banco es el sinpe? Mamá lo canceló',
     'Ya les pasamos la plata', 'Ya les mandamos la plata', 'Ya les mandamos el dinero', 'Ya les enviamos la plata', 'Ya les pasaron la plata', 'Les mandaron la plata', 'ya les enviamos los 15 mil', 'ya les mandamos ₡15000', 'Mi papá lo transfirió', 'Mamá lo canceló', 'Lo canceló mi hermano', 'Se canceló ayer', 'Abonamos ayer', 'La mitad la abonamos', 'ya les cayó', 'ya les cayó?',
     'Como pagamos por sinpe, ¿cuándo nos llega el pedido?', 'Cuando pagamos el sinpe nos dijeron que llegaba en 2 días']
    const agent = ['¿Cómo pagamos?', '¿Cómo puedo pagar?', 'Se puede pagar con tarjeta?', '¿Aceptan transferencia?', '¿Cuál es el número de sinpe?', '¿Hacen contra entrega en Cartago?', 'Puedo pagar contra entrega?', '¿Con qué banco es el sinpe?', 'Hola buenas, ¿cómo puedo pagar?', 'Quiero pagar con tarjeta', '¿Cuál es la política de cambios y devoluciones?', '¿El pago es por adelantado?', 'Hola! Quiero comprar 2 parches. ¿Aceptan tarjeta?', '¿Puedo pagar al recibir?', '¿Cuánta plata es?', 'cuanto es el envio?']
    const bad: string[] = []
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    for (const t of ['Ya les pasaron la plata', 'Mamá lo canceló', 'Mi papá lo transfirió']) if (!hasPaymentWord(t)) bad.push('(info) no payment word: ' + t)
    
    assert.deepEqual(bad.filter((b) => !b.startsWith("(info)")), [])
  })
  it("verifier round 7 repros and false positives", async () => {
    const { classifyPaymentText } = await import("../soft-ai/payment-classifier")
    const person = ['¿Puedo hacerles una transferencia? hecho', '¿Puedo hacerles una transferencia? already sent', '¿Puedo hacerles una transferencia? Mamá lo canceló', 'Mamá lo canceló. ¿Puedo hacerles la transferencia del resto?', '¿Puedo hacerles la transferencia otra vez? la anterior falló', '¿Aceptan tarjeta? ya lo usé', '¿Aceptan transferencia? el otro no me sirvió', '¿Cómo puedo pagar el resto? Mi esposo canceló la mitad',
     'Ya sinpié', 'Ya les sinpié', 'Ya te sinpié, ¿cómo pago el envío?', 'Mi esposo les sinpeó, ¿cómo pagamos el envío?', 'Mi esposo canceló la mitad, quiero pagar el resto', 'Mi mamá lo canceló, quiero pagar el envío', 'Mi esposo lo canceló, ¿cómo pagamos el envío?',
     'Pasame el link para pagar, el otro no sirvió', 'Quiero pagar con el link pero no me abre', 'Quiero pagar con el link, el otro venció', 'Voy a pagar con el link de nuevo, el otro no funcionó', 'Para pagar el resto me pasás otro link?', 'Quiero pagar por sinpe, el link no me sirvió', 'Quiero pagar otra vez, el otro no funcionó', 'La tarjeta fue rechazada', 'Me rechazaron la tarjeta']
    const agent = ['Vi el link en la bio, quiero comprar', 'Hola! vi el link en su perfil, quiero comprar el de dormir', '¿Tienen link para comprar?', 'Pasame el link para comprar', 'Me pasas el link de la pagina porfa', '¿Me pasás el link de la tienda para comprar?', '¿El adhesivo da rechazo?', '¿Los parches pueden dar rechazo o alergia?', 'Tengo rechazo a los adhesivos, ¿me sirven?', '¿Se puede apartar con un abono?', '¿Aceptan abono?', '¿Cuánto es el abono para apartar?',
     'Pura vida, ¿me pasás el link de pago?', 'Upe, ¿tienen link de pago?', 'Mae, pasame el link de pago', 'Holaa, ¿cómo puedo pagar?', 'Quiero los 2 de dormir, me pasás el link de pago?', 'Me interesa el combo. ¿Tienen link de pago?', 'Me pasás el link de pago? Gracias', 'Me podrías pasar el link de pago?', '¿Cuál es el link de pago?', 'Me regalan el link de pago?', '¿Puedo hacerles un sinpe mañana?', '¿Puedo hacerles el sinpe ahora?', '¿Puedo hacerles un sinpe hoy en la noche?', 'Hola 😁 ¿cómo puedo pagar?', 'Listo, quiero pagar por sinpe', 'Quiero pagar con tarjeta']
    const bad: string[] = []
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    
    assert.deepEqual(bad, [])
  })
  it("INT-138: one sentence rule — sensitive group + assurance is held; doctor referrals and payment sentences pass", () => {
    const held = ['Puede usarlo durante el embarazo sin problema', 'Se puede usar en el embarazo', 'Se puede usar durante la lactancia', 'Lo puedes usar en el embarazo', 'Puedes tomarlo con tus medicamentos', 'Las embarazadas lo pueden usar', 'Es seguro para mujeres embarazadas', 'Apto para embarazadas', 'Totalmente seguro durante la lactancia', 'Es segurísimo en el embarazo', 'Es seguro incluso en el embarazo', 'Es seguro de usar en el embarazo', 'No es peligroso en el embarazo', 'No es dañino para niños', 'No le hace daño al bebé', 'No afecta el embarazo', 'No interactúa con medicamentos', 'No contiene químicos así que es seguro en el embarazo', 'No tiene químicos por eso es seguro en el embarazo', 'No pasa nada es seguro en el embarazo', 'Es natural, no tiene ningún riesgo en el embarazo', 'Sin riesgo para tu bebé', 'Es seguro tomarlo con tus medicamentos',
     'No hay efectos secundarios', 'No produce efectos secundarios', 'Libre de efectos secundarios', 'Cero efectos secundarios', 'No presenta contraindicaciones', 'No tiene efectos secundarios']
    const ok = ['Para saber si es seguro en el embarazo, consultá con tu médico', 'Sobre si podés tomarlo con tus medicamentos, lo mejor es consultarlo con tu médico', '¿Podés usarlo con tus medicamentos? Eso lo tiene que decir tu médico', 'Podés usarlos durante el tratamiento de 30 días', 'Es seguro pagar con tarjeta en la web', 'Es apto para todo tipo de piel', 'Podés pagar con tarjeta sin ningún riesgo', 'Durante el embarazo, consultá con tu médico antes de usarlo', 'No se recomienda en el embarazo; consultá con tu médico.', 'El envío es seguro y llega en 2 a 5 días', 'Con piel sensible puede haber enrojecimiento; si pasa, retiralo', 'Tenemos parches para niños? No, son para adultos.', 'Es un suplemento de bienestar, no un medicamento.', 'Podés pedirlo para tu mamá y te llega en 2 días']
    const bad: string[] = []
    for (const t of held) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    for (const t of ok) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t + '  ⇐ ' + resultsClaimIn(t))
    const ctx = validateAgentOutput({ text: '¡Sí! Podés usarlo sin problema 😊', citedToolNames: [], customerText: '¿Lo puedo usar si estoy embarazada?' } as any)
    if (!ctx.reasons?.includes('results_claim')) bad.push('context: pregnancy "sí podés" not held ' + JSON.stringify(ctx.reasons))
    const ctxOk = validateAgentOutput({ text: 'Durante el embarazo, consultá con tu médico antes de usarlo 💚', citedToolNames: [], customerText: '¿Lo puedo usar si estoy embarazada?' } as any)
    if (ctxOk.reasons?.includes('results_claim')) bad.push('context: doctor answer held')
    const more = ['No tiene ningún riesgo 😊', 'No hay ningún riesgo, es natural', 'No hay peligro para el bebé', 'No le hace daño al bebé', 'No tiene riesgo alguno para tu salud', 'Cero riesgo para tu bebé', 'Son 100% seguros para niños', 'Podés usarlo durante la lactancia sin problema', 'no causa ningún riesgo', 'Es seguro en el embarazo, igual consultá con tu médico']
    const more2 = ['Pagar por SINPE no tiene ningún riesgo para vos', 'El link de pago es seguro, no hay ningún riesgo para usted']
    const bad2: string[] = []
    for (const t of more) if (!resultsClaimIn(t)) bad2.push('MISSED ' + t)
    for (const t of more2) if (resultsClaimIn(t)) bad2.push('FALSE+ ' + t)
    
    assert.deepEqual(bad, [])
    assert.deepEqual(bad2, [])
  })
})

describe("advisor (luna-10): unmistakable payment confirmations are held on every reply", () => {
  it("held with no payment words in the chat; ordinary payment / delivery lines pass", () => {
    const v = (text: string, customerText = 'hola') => (validateAgentOutput({ text, citedToolNames: [], customerText } as any).reasons || []).includes('payment_status_claim')
    const held = ['¡Listo! Recibimos tu sinpe 🙌', 'Pago verificado, gracias', 'Tu pago ya está confirmado', 'Ya se acreditó 😊', 'Verificamos tu pago y sale mañana']
    const ok = ['Cuando hagas el SINPE, mandame el comprobante y lo revisamos 😊', 'Podés pagar con tarjeta en la web', 'Te llega en 2 a 4 días', 'Un compañero revisa tu comprobante y te confirma']
    const bad: string[] = []
    for (const t of held) if (!v(t)) bad.push('MISSED ' + t)
    for (const t of ok) if (v(t)) bad.push('FALSE+ ' + t)
    
    assert.deepEqual(bad, [])
  })
})

describe("verifier round 8 (luna-10): no backtracking blow-up, everyday payment questions, health shipping lines", () => {
  it("the prefix grammar stays fast on 300-char repeats (INT-142 ReDoS)", async () => {
    const { classifyPaymentText } = await import("../soft-ai/payment-classifier")
    for (const u of ["ok ", "quiero ", "hola ", "gracias ", "ah ok ", "va ", "quiero comprar los y ", "ok, "]) for (const t of [" x ¿aceptan tarjeta?", " ¿me pasás el link de pago? x", " puedo hacerles un sinpe? x"]) {
      const text = u.repeat(Math.floor((290 - t.length) / u.length)) + t
      const started = Date.now()
      classifyPaymentText(text)
      assert.ok(Date.now() - started < 200, JSON.stringify(u) + " took " + (Date.now() - started) + " ms")
    }
  })
  it("contra entrega / thanks / names / places / context sentences reach the agent; claims still go to a person", async () => {
    const { classifyPaymentText } = await import("../soft-ai/payment-classifier")
    const agent = ['Contra entrega. Gracias', 'Va, contra entrega', 'Sí, contra entrega. Gracias!', 'Contra entrega por favor. Ana Rojas, Heredia', 'Pago contra entrega. Estoy en Cartago', 'Vivo en Heredia. ¿Hacen contra entrega?', 'Ana Rojas\nHeredia, San Pablo\n8888-1234\nContra entrega', 'Bueno, quiero pagar contra entrega',
     'Quiero pagar con tarjeta. Gracias', 'Quisiera saber cómo puedo pagar. Gracias', 'Prefiero pagar contra entrega. Gracias', '¿Hacen contra entrega en San José?', '¿Hacen contra entrega a Jacó?', 'Hola, soy José, ¿aceptan sinpe?', '¿Podré pagar con tarjeta?', '¿Puedo pagar cuando me dé el pedido?',
     'Me preguntaba si aceptan tarjeta', 'Estaba viendo, ¿aceptan sinpe?', 'Tengo una duda. ¿Aceptan tarjeta?', 'Me llamo Ana Rojas. ¿Cómo puedo pagar?', 'Quiero hacer un pedido. ¿Aceptan sinpe?', '¿Cómo puedo pagar? Me urge',
     '¿A qué número les paso la plata?', '¿Cómo les mando el dinero?', '¿Les paso la plata por sinpe o por transferencia?', '¿Les envio la plata hoy?', '¿Cuándo les paso la plata?',
     '¿Tienen link para pagar con tarjeta?', '¿Tienen link de pago para pagar con tarjeta?', '¿Con el link de pago puedo pagar con tarjeta de débito?', '¿Puedo pagar con link de pago?']
    const person = ['Está pago, ¿hacen contra entrega del envío?', 'La plata ya está', 'Mamá lo canceló. ¿Hacen contra entrega?', 'Ya tienen el link de pago', 'Contra entrega. Ya les pasé la plata', 'Mi esposo pagó con tarjeta, ¿cómo pago el envío?', 'Le di la plata al mensajero, ¿cómo pago el envío?']
    const bad: string[] = []
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    
    assert.deepEqual(bad, [])
  })
  it("health: shipping / guarantee / referral lines pass; inofensivo / inocuo / hijo / dar de mamar are held", () => {
    const ok = ['Tenemos garantía, así que no hay ningún riesgo', 'No hay riesgo de que se pierda el paquete, va con guía', 'El paquete va asegurado, cero riesgo', 'No hay peligro, el mensajero te llama antes', 'Comprá sin riesgo: si no te gusta, lo cambiamos', 'Te recomiendo consultarlo con tu médico, ya que podés estar tomando medicamentos', 'Es un gran regalo para el Día del Niño, podés pedirlo hoy']
    const held = ['Es libre de riesgos para la salud', 'No tiene ni un riesgo para tu salud', 'No te hace daño, es natural', 'Es totalmente inofensivo para el bebé', 'Es inocuo en el embarazo', 'Lo puede usar su hijo de 10 años', 'No hay problema si estás dando de mamar', 'Para diabéticos es perfecto', 'Tranqui, no interfiere con tus medicamentos', 'Lo podés combinar con tus pastillas sin problema', 'Lo pueden usar los niños', 'Es seguro para la presión alta', 'No pasa nada si lo usás con medicamentos']
    const bad: string[] = []
    for (const t of ok) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t + ' ⇐ ' + resultsClaimIn(t))
    for (const t of held) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    const ctx = validateAgentOutput({ text: '¡Claro! Podés recibirlo en Cartago mañana 😊', citedToolNames: [], customerText: 'Gracias corazón, ¿me lo pueden enviar a Cartago?' } as any)
    if (ctx.reasons?.includes('results_claim')) bad.push('context: corazón held')
    
    assert.deepEqual(bad, [])
  })
  it("a negated method (\"No uso SINPE\", \"Sin tarjeta\") gets the method list, not that one method", async () => {
    const { decideInbound } = await import("../soft-ai/inbound-decision")
    const { RESERVED_SHORTCUT_SEEDS } = await import("../soft-ai/shortcuts")
    const { parseBrandFacts } = await import("../soft-ai/brand-facts")
    const facts = parseBrandFacts({ schemaVersion: 1, payment: { shareWithCustomers: true, methods: ["sinpe", "tarjeta"], sinpe: { number: "62019914", holderName: "R G" }, cardPaymentUrl: "https://tienda.example.cr" } })
    const shortcuts = RESERVED_SHORTCUT_SEEDS.map((x, i) => ({ ...x, isActive: true, sortOrder: i }))
    for (const t of ["No uso SINPE, ¿qué otras formas de pago tienen?", "Sin tarjeta, ¿cómo pago?", "¿Aceptan algo que no sea tarjeta?"]) {
      const d = decideInbound({ inboundText: t, brandFacts: facts, shortcuts })
      assert.doesNotMatch(d.text, /6201 ?9914|tienda.example.cr/, t + " → " + d.text)
      // Verifier round 10: and it is ANSWERED with the list — a hand-off also has no numbers, so check that too.
      assert.notEqual(d.paymentClass, "payment_proof_or_risk", t)
      assert.match(d.text, /SINPE M[oó]vil/, t + " → " + d.text)
    }
  })
})

describe("SecureDog round 6 (luna-10): bursts, comma claims, third person, perfect tense, per-phrase health exemptions", () => {
  it("classifier: claims before a comma / in a burst / third person / perfect tense go to a person; real asks still reach the agent", async () => {
    const { classifyPaymentText } = await import("../soft-ai/payment-classifier")
    const { decideInbound } = await import("../soft-ai/inbound-decision")
    const { RESERVED_SHORTCUT_SEEDS } = await import("../soft-ai/shortcuts")
    const { parseBrandFacts } = await import("../soft-ai/brand-facts")
    const person = ['Pagado, ¿cómo pago el envío?', 'Mi esposo ha pagado la mitad, ¿cómo pago el resto?', 'Mi esposo ha pagado la mitad, ¿puedo pagar el resto mañana?', 'Mi esposo ha pagado la mitad, ¿el resto lo puedo pagar contra entrega?', '¿Como pago el resto si mi esposo pago la mitad?', 'Quiero pagar el resto, mi esposo deposito la mitad', 'Mi esposo te deposito la mitad, ¿cuál es la cuenta para el resto?', 'Ahorita les cae el sinpe, ¿cuál es el número de pedido?',
     'Le mande. ¿Cómo pago el envío?', 'Mi esposo se encargo. ¿Cómo pago el envío?', 'Mi mamá se lo dio al mensajero. ¿Cómo pago el envío?', 'Le pase 20.000. ¿Cómo pago el envío?', 'Mi esposo les mando todo. ¿Cómo pago el envío?', 'Mi esposo lo Resolvió. ¿Cómo pago el envío?',
     'Te mandé 20.000', 'Le pasé 15.000', 'Ya les pasamos 15.000', 'ya le pasé los 25.500', 'Mi esposo le paso 20 mil', 'Ya he pagado', 'He transferido', 'Hemos transferido todo', 'Me sale rechazada la tarjeta, ¿aceptan sinpe?', 'Me rechazo la tarjeta, ¿aceptan sinpe?']
    const agent = ['¿Cómo pago el envío?', 'Contra entrega. Gracias', 'Vivo en Heredia. ¿Hacen contra entrega?', 'Ana Rojas\nHeredia, San Pablo\n8888-1234\nContra entrega', 'Tengo una duda. ¿Aceptan tarjeta?', '¿Cuándo me llega si pago hoy?', '¿Pago la mitad ahora y la mitad al recibir?', '¿Aceptan transferencia?', 'Hola, ¿puedo pagar con tarjeta?']
    const bad: string[] = []
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    // Burst: "Ya les pagué la mitad" then "¿Cómo pago el resto?" → one decision for both → payment hand-off.
    const facts = parseBrandFacts({ schemaVersion: 1, payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '62019914', holderName: 'R G' } } })
    const shortcuts = RESERVED_SHORTCUT_SEEDS.map((x, i) => ({ ...x, isActive: true, sortOrder: i }))
    const d = decideInbound({ inboundText: '¿Cómo pago el resto?', earlierCustomerTexts: ['Ya les pagué la mitad'], brandFacts: facts, shortcuts })
    if (d.paymentClass !== 'payment_proof_or_risk' || !d.escalate || /6201/.test(d.text)) bad.push('burst not handed off: ' + JSON.stringify({ c: d.paymentClass, e: d.escalate, t: d.text }))
    const d2 = decideInbound({ inboundText: '¿Cómo pago?', earlierCustomerTexts: ['hola', 'quiero el de dormir'], brandFacts: facts, shortcuts })
    if (d2.paymentClass === 'payment_proof_or_risk') bad.push('plain burst handed off')
    
    assert.deepEqual(bad, [])
  })
  it("health: every exemption belongs to the phrase; context covers the whole burst; a referral does not cancel it", () => {
    const v = (text: string, customerText: string) => (validateAgentOutput({ text, citedToolNames: [], customerText } as any).reasons || []).includes('results_claim')
    const held = ['No prometemos milagros, pero es totalmente seguro en el embarazo', 'No prometemos nada, pero en una semana vas a notar resultados', 'Nunca prometemos milagros, pero te va a quitar la ansiedad', 'Es seguro aunque tengas problemas del corazón', 'Es seguro en el embarazo, no debés preocuparte', 'No usa químicos, por eso es seguro en el embarazo', 'Es totalmente seguro en el embarazo, y si tenés dudas podés consultar con tu médico', 'Sí, es seguro para adultos mayores']
    const ctxHeld: Array<[string, string]> = [
      ['Sí, podés usarlo durante el embarazo, igual consultalo con tu médico', '¿Lo puedo usar si estoy embarazada?'],
      ['No tiene ningún riesgo, te lo entregamos mañana', 'Estoy embarazada, ¿es seguro?'],
      ['¿Con tus pastillas? Sí, sin problema. Igual consultá con tu médico.', 'Tomo pastillas para la presión, ¿lo puedo usar?'],
      ['¡Claro! Podés usarlo sin problema', 'Soy hipertensa, ¿lo puedo usar?'],
      ['¡Sí! Podés usarlo tranquila', 'Tomo anticoagulantes, ¿lo puedo usar?'],
      ['Sí, podés usarlo sin problema', 'Estoy en gestación, ¿lo puedo usar?'],
      ['¡Sí! Podés usarlo sin problema', 'Estoy embarazada\n¿Lo puedo usar?'],
    ]
    const ok = ['Para saber si es seguro en el embarazo, consultá con tu médico', 'Te recomiendo consultarlo con tu médico, ya que podés estar tomando medicamentos', 'No es seguro en el embarazo; consultá con tu médico', 'Durante el embarazo, consultá con tu médico antes de usarlo', 'El paquete va asegurado, cero riesgo', 'Es un gran regalo para el Día del Niño, podés pedirlo hoy']
    const ctxOk: Array<[string, string]> = [
      ['Durante el embarazo, consultá con tu médico antes de usarlo 💚', '¿Lo puedo usar si estoy embarazada?'],
      ['¡Claro! Podés recibirlo en Cartago mañana 😊', 'Gracias corazón, ¿me lo pueden enviar a Cartago?'],
      ['Te recomiendo consultarlo con tu médico, ya que podés estar tomando medicamentos', 'Tomo medicamentos, ¿lo puedo usar?'],
    ]
    const bad: string[] = []
    for (const t of held) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    for (const [r, c] of ctxHeld) if (!v(r, c)) bad.push('MISSED (ctx) ' + r + ' ⇐ ' + c)
    for (const t of ok) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t + ' ⇐ ' + resultsClaimIn(t))
    for (const [r, c] of ctxOk) if (v(r, c)) bad.push('FALSE+ (ctx) ' + r + ' ⇐ ' + c)
    if (!resultsClaimIn('Los parches son suplementos de bienestar, no medicamentos: nunca prometas curar, tratar o bajar de peso.', { instructions: true }) === false) {}
    if (resultsClaimIn('Los parches son suplementos de bienestar, no medicamentos: nunca prometas curar, tratar o bajar de peso.', { instructions: true })) bad.push('lint: instruction flagged')
    
    assert.deepEqual(bad, [])
  })
  it("live and Probar pass the whole burst to the decision and the reply checks", () => {
    const src = fs.readFileSync("src/lib/soft-ai/agent-turn.ts", "utf8")
    assert.equal(src.split("earlierCustomerTexts: earlierCustomerTexts(history),").length - 1, 2)
    assert.ok(src.includes("customerText: customerTextSinceLastAnswer(history, payload.content),"))
    assert.ok(src.includes("customerText: customerTextSinceLastAnswer(input.history ?? [], input.inboundText),"))
    assert.ok(fs.readFileSync("src/lib/soft-ai/llm/runtime.ts", "utf8").includes("customerText: burstCustomerText(input.history, input.inboundText),"))
  })
})

describe("verifier round 9 (luna-10): done-verbs outside a question, hijos is not a health group, more health wordings", () => {
  it("repros hold", async () => {
    const { classifyPaymentText } = await import("../soft-ai/payment-classifier")
    const person = ['¿Aceptan sinpe? Le hice uno', '¿Cómo pago el envío? Lo hice en la mañana', '¿Cómo pago? Lo hice desde la app del banco', '¿Me pasás el número de sinpe? Te lo pase en la mañana', '¿Aceptan sinpe? Le tiré hace un toque', 'Contra entrega se lo di al mensajero', '¿Hacen contra entrega? Le di al mensajero', '¿Cómo pago el resto? Le di 10 mil al mensajero']
    const agent = ['¿Cómo pago el envío?', 'Contra entrega. Gracias', 'Pago contra entrega. Estoy en Cartago', 'Quiero pagar con tarjeta. Gracias']
    const bad: string[] = []
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    const v = (text: string, customerText: string) => (validateAgentOutput({ text, citedToolNames: [], customerText } as any).reasons || []).includes('results_claim')
    for (const [r, c] of [['¡Claro! Podés pedirlo con envío a Heredia', 'Es para mi hija, ¿hacen envíos a Heredia?'], ['Se pega en la piel limpia. Podés usarlo de día', 'Mis hijos me lo regalaron, ¿cómo se usa?']] as const) if (v(r, c)) bad.push('FALSE+ (ctx) ' + r)
    if (resultsClaimIn('Lo podés regalar a tu mamá, a tu pareja o a tus hijos')) bad.push('FALSE+ hijos')
    if (!v('¡Sí! Podés usarlo sin problema 😊', 'Tengo problemas del corazón, ¿lo puedo usar?')) bad.push('MISSED corazón')
    for (const t of ['Es 100% natural, no te va a hacer daño', 'Durante la lactancia no hay ningún inconveniente', 'Es seguro para todas las edades', 'No genera dependencia', 'Lo puede usar su hijo de 10 años']) if (!resultsClaimIn(t)) bad.push('MISSED ' + t)
    
    assert.deepEqual(bad, [])
  })
})

describe("verifier round 10 (luna-10): the clause before ¿ is checked for claims only, bursts count real claims, health referrals pass", () => {
  it("repros hold", async () => {
    const { classifyPaymentText } = await import("../soft-ai/payment-classifier")
    const { decideInbound } = await import("../soft-ai/inbound-decision")
    const { RESERVED_SHORTCUT_SEEDS } = await import("../soft-ai/shortcuts")
    const { parseBrandFacts } = await import("../soft-ai/brand-facts")
    const agent = ['No tengo tarjeta, ¿cómo puedo pagar?', 'No uso SINPE, ¿qué otras formas de pago tienen?', 'Sin tarjeta, ¿cómo pago?', 'No tengo sinpe, ¿aceptan tarjeta?', 'Con tarjeta, ¿se puede?', 'Mi esposo va a pagar, ¿aceptan tarjeta?', 'Hola, para el pago, ¿aceptan sinpe?', 'Sí, por sinpe, ¿me pasás el número?', 'Bueno, sinpe entonces, ¿a qué número?', 'Perfecto, por transferencia, ¿a qué cuenta?', 'La entrega es en Heredia, ¿cómo pago?', 'Ah ok, entonces el pago es contra entrega, ¿verdad?',
     'Quiero que me lo mande a Heredia, ¿cómo pago?', 'Pago contra entrega, quiero que me lo mande el lunes', 'Contra entrega por favor, me lo mande a la casa', '¿Y si la tarjeta sale rechazada?', '¿Qué pasa si la tarjeta me sale rechazada?']
    const person = ['Pagado, ¿cómo pago el envío?', 'Ya les pagué la mitad, ¿cómo pago el resto?', 'La tarjeta no funciona, ¿aceptan sinpe?', 'Mi esposo ha pagado la mitad, ¿cómo pago el resto?', 'Le pase 20.000. ¿Cómo pago el envío?', 'Me sale rechazada la tarjeta, ¿aceptan sinpe?', 'Mamá lo canceló, ¿hacen contra entrega?']
    const bad: string[] = []
    for (const t of agent) { const c = classifyPaymentText(t); if (c === 'payment_proof_or_risk') bad.push(`AGENT expected: "${t}" → ${c}`) }
    for (const t of person) { const c = classifyPaymentText(t); if (c !== 'payment_proof_or_risk') bad.push(`PERSON expected: "${t}" → ${c}`) }
    const facts = parseBrandFacts({ schemaVersion: 1, payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta'], sinpe: { number: '62019914', holderName: 'R G' }, cardPaymentUrl: 'https://tienda.example.cr' } })
    const shortcuts = RESERVED_SHORTCUT_SEEDS.map((x, i) => ({ ...x, isActive: true, sortOrder: i }))
    for (const t of ['No uso SINPE, ¿qué otras formas de pago tienen?', 'Sin tarjeta, ¿cómo pago?']) { const d = decideInbound({ inboundText: t, brandFacts: facts, shortcuts }); if (d.paymentClass === 'payment_proof_or_risk' || !/SINPE M[oó]vil/.test(d.text) || !/Tarjeta/i.test(d.text)) bad.push('negated method not answered with the list: ' + t + ' → ' + d.text) }
    // Bursts after "¿Cómo preferís pagar?": answers, not hand-offs; a real claim earlier still hands off.
    for (const [earlier, latest] of [['Sinpe', 'gracias'], ['Sinpe', '¿a qué número?'], ['No tengo sinpe', '¿aceptan tarjeta?'], ['El pago', '¿es por adelantado?'], ['Mañana les pago', '¿me lo apartan?']]) { const d = decideInbound({ inboundText: latest, earlierCustomerTexts: [earlier], brandFacts: facts, shortcuts, awaitingPaymentMethod: true }); if (d.paymentClass === 'payment_proof_or_risk' && /earlier_message/.test(String(d.decisionTrace.steps[0].reason))) bad.push(`burst handed off: "${earlier}" + "${latest}"`) }
    for (const [earlier, latest] of [['Ya les pagué la mitad', '¿Cómo pago el resto?'], ['Mamá lo canceló', 'gracias'], ['Le pase 20.000', '¿cómo pago el envío?']]) { const d = decideInbound({ inboundText: latest, earlierCustomerTexts: [earlier], brandFacts: facts, shortcuts }); if (d.paymentClass !== 'payment_proof_or_risk') bad.push(`burst claim missed: "${earlier}" + "${latest}"`) }
    // Health: referral answers pass; non-health safety questions pass.
    const v = (text: string, customerText: string) => (validateAgentOutput({ text, citedToolNames: [], customerText } as any).reasons || []).includes('results_claim')
    for (const t of ['Tu médico te puede decir si lo podés usar durante el embarazo 💚', 'Si estás embarazada, consultalo con tu médico; él te puede orientar 💚', 'No te puedo asegurar que no tenga riesgos en el embarazo: consultá con tu médico', 'Con diabetes, su médico es quien le puede decir si es adecuado 💚']) if (resultsClaimIn(t)) bad.push('FALSE+ ' + t)
    for (const [r, c] of [['¡Sí! Es seguro: somos tienda en Heredia y el pago va por la web 😊', '¿Es seguro comprar por aquí?'], ['Va con seguro de envío y número de guía 📦', 'Hay riesgo de que se pierda el paquete?'], ['El envío a Cartago es ₡3.000. ¡Perfecto! ¿A qué provincia?', 'Tomo pastillas para la presión\nbueno, ¿cuánto es el envío?'], ['Si querés, podés preguntarle a tu médico y nos contás 😊', '¿Lo puedo usar si tomo pastillas?']] as const) if (v(r, c)) bad.push('FALSE+ (ctx) ' + r)
    
    assert.deepEqual(bad, [])
  })
})
