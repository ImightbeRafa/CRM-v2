/**
 * luna-10 hard blocks (2026-10-17, PatchHouse live chats): code-owned stops for the mistakes the model made.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resultsClaimIn, validateAgentOutput } from '../soft-ai/llm/output-validator'
import { REPAIRABLE_REASONS, repairInstruction } from '../soft-ai/llm/runtime'
import { decideWaitingAck, waitingAckKey, waitingAckText } from '../soft-ai/waiting-ack'
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
