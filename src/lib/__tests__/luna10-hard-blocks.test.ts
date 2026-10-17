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
