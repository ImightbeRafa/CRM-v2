/**
 * agents2-hours — "Horario de atención" per agent: CR schedule math (overnight windows, day boundaries), after-hours
 * hand-off texts (pass the write-claim / deal / confirmation checks), the prompt line only after hours, quiet
 * after-hours alerts + one morning summary, default off = no behaviour change. Pure + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  afterHoursHandoffKind,
  afterHoursHandoffLine,
  afterHoursPromptLine,
  afterHoursState,
  applyAfterHoursText,
  businessHoursSchema,
  DEFAULT_BUSINESS_HOURS,
  formatCrTime,
  IN_HOURS,
  isWithinBusinessHours,
  nextOpening,
  nightKeySuffix,
  parseBusinessHours,
  quietUntilFromKey,
  stripNightSuffix,
  type BusinessHours,
} from '@/lib/soft-ai/business-hours'
import { validateAgentOutput, dealProblem } from '@/lib/soft-ai/llm/output-validator'
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'
import { SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { detectMorningAlerts, detectNewReviewAlerts, morningSummaryText, MORNING_ANNOUNCE_WINDOW_MS } from '@/lib/notification-alerts'
import { orderIsCashFromDedupeKey, paymentVariantFromDedupeKey, handoffNotificationText } from '@/lib/workspace-notifications'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

/** A CR wall-clock instant (UTC-6): 2026-10-19 is a Monday. */
const cr = (isoLocal: string) => new Date(`${isoLocal}-06:00`)

const WEEKDAYS: BusinessHours = {
  enabled: true,
  timezone: 'America/Costa_Rica',
  // Lun–Vie 8:00–17:00, Sáb 9:00–12:00, Dom cerrado.
  windows: [
    ...[1, 2, 3, 4, 5].map((day) => ({ day, open: '08:00', close: '17:00' })),
    { day: 6, open: '09:00', close: '12:00' },
  ],
  afterHoursNote: null,
}
const NIGHT_SHIFT: BusinessHours = {
  enabled: true,
  timezone: 'America/Costa_Rica',
  // Vie 20:00–02:00 (overnight), Sáb 22:00–03:00 (overnight into Sunday = across the week end).
  windows: [
    { day: 5, open: '20:00', close: '02:00' },
    { day: 6, open: '22:00', close: '03:00' },
  ],
}

describe('agents2-hours: schedule math (Costa Rica time)', () => {
  it('off = always within hours (default, no behaviour change)', () => {
    assert.equal(isWithinBusinessHours(DEFAULT_BUSINESS_HOURS, cr('2026-10-19T03:00:00')), true)
    assert.equal(isWithinBusinessHours(null, new Date()), true)
    assert.deepEqual(afterHoursState(DEFAULT_BUSINESS_HOURS, cr('2026-10-19T03:00:00')), IN_HOURS)
    assert.equal(afterHoursPromptLine(IN_HOURS), null)
  })
  it('day boundaries: open inclusive, close exclusive', () => {
    assert.equal(isWithinBusinessHours(WEEKDAYS, cr('2026-10-19T07:59:00')), false)
    assert.equal(isWithinBusinessHours(WEEKDAYS, cr('2026-10-19T08:00:00')), true)
    assert.equal(isWithinBusinessHours(WEEKDAYS, cr('2026-10-19T16:59:00')), true)
    assert.equal(isWithinBusinessHours(WEEKDAYS, cr('2026-10-19T17:00:00')), false)
    assert.equal(isWithinBusinessHours(WEEKDAYS, cr('2026-10-25T10:00:00')), false) // domingo
    assert.equal(isWithinBusinessHours(WEEKDAYS, cr('2026-10-24T11:30:00')), true) // sábado
  })
  it('the UTC day differs from the CR day (23:30 CR Monday = Tuesday 05:30 UTC)', () => {
    const lateMonday: BusinessHours = { enabled: true, timezone: 'America/Costa_Rica', windows: [{ day: 1, open: '23:00', close: '23:59' }] }
    assert.equal(isWithinBusinessHours(lateMonday, cr('2026-10-19T23:30:00')), true)
    assert.equal(isWithinBusinessHours(lateMonday, cr('2026-10-20T23:30:00')), false)
  })
  it('overnight windows, including Saturday → Sunday across the week end', () => {
    assert.equal(isWithinBusinessHours(NIGHT_SHIFT, cr('2026-10-23T21:00:00')), true) // vie 21:00
    assert.equal(isWithinBusinessHours(NIGHT_SHIFT, cr('2026-10-24T01:59:00')), true) // sáb 01:59
    assert.equal(isWithinBusinessHours(NIGHT_SHIFT, cr('2026-10-24T02:00:00')), false)
    assert.equal(isWithinBusinessHours(NIGHT_SHIFT, cr('2026-10-25T02:30:00')), true) // dom 02:30 (from sáb)
    assert.equal(isWithinBusinessHours(NIGHT_SHIFT, cr('2026-10-25T03:00:00')), false)
  })
  it('nextOpening labels: hoy / mañana / el <día>', () => {
    assert.equal(nextOpening(WEEKDAYS, cr('2026-10-19T06:30:00'))?.label, 'hoy a las 8:00 a. m.')
    assert.equal(nextOpening(WEEKDAYS, cr('2026-10-19T22:00:00'))?.label, 'mañana a las 8:00 a. m.')
    assert.equal(nextOpening(WEEKDAYS, cr('2026-10-24T13:00:00'))?.label, 'el lunes a las 8:00 a. m.')
    assert.equal(nextOpening(WEEKDAYS, cr('2026-10-23T18:00:00'))?.label, 'mañana a las 9:00 a. m.')
    const next = nextOpening(WEEKDAYS, cr('2026-10-19T22:00:00'))
    assert.equal(next?.date.toISOString(), cr('2026-10-20T08:00:00').toISOString())
    assert.equal(nextOpening(NIGHT_SHIFT, cr('2026-10-21T10:00:00'))?.label, 'el viernes a las 8:00 p. m.')
    assert.equal(nextOpening({ ...WEEKDAYS, windows: [] }, new Date()), null)
    assert.equal(formatCrTime(0), '12:00 a. m.')
    assert.equal(formatCrTime(12 * 60 + 30), '12:30 p. m.')
  })
  it('schema: zod-validated, CR timezone only, ≤ 3 windows per day, note ≤ 200; stored junk = off', () => {
    assert.equal(businessHoursSchema.safeParse(WEEKDAYS).success, true)
    assert.equal(businessHoursSchema.safeParse({ ...WEEKDAYS, timezone: 'America/New_York' }).success, false)
    assert.equal(businessHoursSchema.safeParse({ ...WEEKDAYS, windows: [{ day: 7, open: '08:00', close: '10:00' }] }).success, false)
    assert.equal(businessHoursSchema.safeParse({ ...WEEKDAYS, windows: [{ day: 1, open: '8:00', close: '10:00' }] }).success, false)
    assert.equal(businessHoursSchema.safeParse({ ...WEEKDAYS, windows: [{ day: 1, open: '10:00', close: '10:00' }] }).success, false)
    assert.equal(
      businessHoursSchema.safeParse({ ...WEEKDAYS, windows: Array.from({ length: 4 }, (_, i) => ({ day: 1, open: `0${i}:00`, close: `0${i}:30` })) }).success,
      false,
    )
    assert.equal(businessHoursSchema.safeParse({ ...WEEKDAYS, afterHoursNote: 'x'.repeat(201) }).success, false)
    assert.deepEqual(parseBusinessHours('junk'), DEFAULT_BUSINESS_HOURS)
    assert.equal(parseBusinessHours(undefined).enabled, false)
  })
  it('parseSalesRules keeps it; old rows → off', async () => {
    const { parseSalesRules } = await import('@/lib/soft-ai/agent-sales-setup')
    assert.equal(parseSalesRules({}).businessHours?.enabled, false)
    assert.equal(parseSalesRules({ businessHours: WEEKDAYS }).businessHours?.windows.length, 6)
  })
})

describe('agents2-hours: after-hours texts', () => {
  const night = afterHoursState(WEEKDAYS, cr('2026-10-19T22:00:00'))
  it('state + prompt line only after hours', () => {
    assert.equal(night.afterHours, true)
    assert.equal(night.label, 'mañana a las 8:00 a. m.')
    assert.match(afterHoursPromptLine(night) || '', /^Fuera de horario: .*te atiende el asistente automático.*el equipo responde mañana a las 8:00 a\. m\. Nunca prometas revisar o confirmar ahora\./)
    assert.equal(afterHoursPromptLine(afterHoursState(WEEKDAYS, cr('2026-10-19T10:00:00'))), null)
    // Probar "Simular fuera de horario" with the schedule off still gets a label.
    assert.equal(afterHoursState(DEFAULT_BUSINESS_HOURS, new Date(), { simulate: true }).afterHours, true)
  })
  it('the customer texts pass the write-claim / confirmation / deal / payment-status checks', () => {
    for (const kind of ['payment', 'order', 'person'] as const) {
      const text = afterHoursHandoffLine(kind, night.label)
      const v = validateAgentOutput({ text, citedToolNames: [], orderClosing: kind === 'order', customerText: kind === 'payment' ? 'ya pagué' : 'hola', paymentContext: kind === 'payment' })
      assert.deepEqual(v.reasons, [], `${kind}: ${v.reasons.join(',')}`)
      assert.equal(hasConfirmationWording(text), false, kind)
      assert.equal(dealProblem(text, []), false, kind)
      assert.doesNotMatch(text, /confirmad|registrad|ya qued/i)
    }
  })
  it('only TRUE hand-offs get the after-hours text; owner replies and reviews do not', () => {
    assert.equal(afterHoursHandoffKind('payment'), 'payment')
    assert.equal(afterHoursHandoffKind('order_ready_cash'), 'order')
    assert.equal(afterHoursHandoffKind('human_request'), 'person')
    assert.equal(afterHoursHandoffKind('escalate'), 'person')
    assert.equal(afterHoursHandoffKind('owner_reply'), null)
    const pay = { text: SAFE_LINE.payment, handoff: { kind: 'handoff' as const, reason: 'payment' } }
    assert.equal(applyAfterHoursText(pay, IN_HOURS, SAFE_LINE.review), SAFE_LINE.payment)
    assert.match(applyAfterHoursText(pay, night, SAFE_LINE.review), /El equipo revisa tu pago mañana a las 8:00 a\. m\./)
    const review = { text: SAFE_LINE.review, handoff: { kind: 'review' as const, reason: 'review' } }
    assert.equal(applyAfterHoursText(review, night, SAFE_LINE.review), SAFE_LINE.review)
    const owner = { text: 'Te paso con Ana', handoff: { kind: 'handoff' as const, reason: 'owner_reply' } }
    assert.equal(applyAfterHoursText(owner, night, SAFE_LINE.review), 'Te paso con Ana')
    // Order close: the checked reply (order details) stays, the line is added; the safe line is replaced.
    const order = { text: 'Listo, total ₡12.000 contra entrega.', handoff: { kind: 'handoff' as const, reason: 'order_ready' } }
    assert.match(applyAfterHoursText(order, night, SAFE_LINE.review), /^Listo, total ₡12\.000 contra entrega\.\n\n¡Gracias! Recibí los datos de tu pedido\./)
    assert.match(applyAfterHoursText({ ...order, text: SAFE_LINE.review }, night, SAFE_LINE.review), /^¡Gracias! Recibí los datos/)
    // Owner's note appended.
    const withNote = afterHoursState({ ...WEEKDAYS, afterHoursNote: 'Para urgencias escribinos por Instagram.' }, cr('2026-10-19T22:00:00'))
    assert.match(applyAfterHoursText(pay, withNote, SAFE_LINE.review), /\nPara urgencias escribinos por Instagram\.$/)
  })
})

describe('agents2-hours: quiet alerts after hours + one morning summary', () => {
  it('night key round trip; old readers keep working', () => {
    const opens = cr('2026-10-20T08:00:00')
    const key = `ai_handoff:c1:m1:payment:claim${nightKeySuffix(opens)}`
    assert.equal(quietUntilFromKey(key)?.toISOString(), opens.toISOString())
    assert.equal(stripNightSuffix(key), 'ai_handoff:c1:m1:payment:claim')
    assert.equal(paymentVariantFromDedupeKey(key), 'claim')
    assert.equal(orderIsCashFromDedupeKey(`ai_handoff:c1:m1:order_ready_cash${nightKeySuffix(opens)}`), true)
    assert.equal(handoffNotificationText(`ai_handoff:c1:m1:human_request${nightKeySuffix(opens)}`, '')?.snippet, 'Pidió hablar con una persona')
    assert.equal(quietUntilFromKey('ai_handoff:c1:m1:payment'), null)
  })
  it('quiet at night, announced once after opening (12 h window), never as a separate chime', () => {
    const opens = cr('2026-10-20T08:00:00')
    const item = { id: 'n1', kind: 'payment_review', read: false, createdAt: cr('2026-10-19T22:00:00').toISOString(), title: 't', snippet: 's', href: '/chats', quietUntil: opens.toISOString() }
    // Never an individual review chime (night or morning).
    assert.deepEqual(detectNewReviewAlerts(new Set(), [item], cr('2026-10-19T22:00:30').getTime()).alerts, [])
    assert.deepEqual(detectNewReviewAlerts(new Set(), [item], cr('2026-10-20T08:01:00').getTime()).alerts, [])
    // Night: quiet.
    assert.deepEqual(detectMorningAlerts([item], new Set(), cr('2026-10-20T07:59:00').getTime()), [])
    // First poll after opening: in the summary; once announced, never again; read ones are skipped.
    assert.deepEqual(detectMorningAlerts([item], new Set(), cr('2026-10-20T08:00:15').getTime()).map((x) => x.id), ['n1'])
    assert.deepEqual(detectMorningAlerts([item], new Set(['n1']), cr('2026-10-20T08:00:15').getTime()), [])
    assert.deepEqual(detectMorningAlerts([{ ...item, read: true }], new Set(), cr('2026-10-20T08:00:15').getTime()), [])
    assert.deepEqual(detectMorningAlerts([item], new Set(), opens.getTime() + MORNING_ANNOUNCE_WINDOW_MS + 1), [])
    assert.equal(morningSummaryText(3), 'Tenés 3 pendientes de la noche')
    assert.equal(morningSummaryText(1), 'Tenés 1 pendiente de la noche')
  })
  it('server + client wiring (source)', () => {
    const notify = read('src/lib/soft-ai/handoff-notify.ts')
    assert.match(notify, /const night = input\.quietUntil \? nightKeySuffix\(input\.quietUntil\) : ''/)
    assert.match(notify, /dedupeKey: \(\) => `\$\{reviewDedupeKey\(key, reviewKind, lastInbound\?\.messageType\)\}\$\{night\}`/)
    assert.match(notify, /dedupeKey: \(\) => `\$\{key\}\$\{night\}`/)
    // The tag is still added at night (the queue is ready in the morning): it runs before / regardless of quietUntil.
    assert.ok(notify.indexOf('data: { tags: { push: reviewTag } }') < notify.indexOf('const night ='))
    const list = read('src/lib/workspace-notifications.ts')
    assert.match(list, /if \(quietUntil\) items\[i\] = withNightLabel\(items\[i\], quietUntil\)/)
    assert.match(list, /🌙 fuera de horario/)
    const hook = read('src/components/aurora/shell/useWorkspaceNotifications.ts')
    assert.match(hook, /detectMorningAlerts\(items, new Set\(\[\.\.\.readMorningAnnounced\(\), \.\.\.queued\]\)\)/)
    const bell = read('src/components/aurora/shell/AuroraBell.tsx')
    assert.match(bell, /const night = claimMorningAlerts\(\)[\s\S]{0,120}playNotificationChime\(\)[\s\S]{0,80}title: `🌙 \$\{morningSummaryText\(night\.length\)\}`/)
  })
})

describe('agents2-hours: turn wiring (source)', () => {
  const turn = read('src/lib/soft-ai/agent-turn.ts')
  it('live: hours loaded per turn, hand-off text + prompt line + quiet alerts; default IN_HOURS', () => {
    assert.match(turn, /const hours = afterHoursState\(await loadBusinessHours\(row\.tenantId, resolved\.agent\.id\), new Date\(\)\)/)
    assert.match(turn, /if \(plan\.handoff\?\.kind === 'handoff'\) return applyAfterHoursText\(plan, hours, SAFE_LINE\.review\)/)
    assert.match(turn, /finalizePlannedText\(plan, payload, trigger\.sentAt, hours\)/)
    assert.match(turn, /finalizePlannedText\(modelPlan, payload, trigger\.sentAt, hours\)/)
    assert.match(turn, /afterHoursLine: afterHoursPromptLine\(hours\),/)
    assert.match(turn, /quietUntil: afterHours\.afterHours \? afterHours\.opensAt : null,/)
    assert.equal((turn.match(/afterHours: hours,/g) || []).length, 3)
    assert.match(turn, /hours: AfterHoursState = IN_HOURS/)
    assert.match(read('src/lib/soft-ai/llm/prompt.ts'), /if \(input\.afterHoursLine\?\.trim\(\)\) lines\.push\('', input\.afterHoursLine\.trim\(\)\)/)
  })
  it('Probar: in hours unless "Simular fuera de horario"; the quick check never simulates', () => {
    assert.match(turn, /const probarHours = input\.simulateAfterHours === true\s*\? afterHoursState\(await loadBusinessHours\(input\.tenantId, runtimeAgent\.id\), new Date\(\), \{ simulate: true \}\)\s*: IN_HOURS/)
    assert.equal((turn.match(/text = applyAfterHoursText\(plan, probarHours, SAFE_LINE\.review\)/g) || []).length, 2)
    assert.doesNotMatch(read('src/lib/soft-ai/test-engine/run.ts'), /simulateAfterHours/)
    assert.match(read('src/lib/soft-ai/agent-test-schema.ts'), /simulateAfterHours: z\.boolean\(\)\.optional\(\)/)
    assert.match(read('src/app/config/agentes/AgentTestSandbox.tsx'), /Simular fuera de horario/)
  })
  it('settings route: zod schema + owner note checks, audited', () => {
    const route = read('src/app/api/chat/agents/[id]/settings/route.ts')
    assert.match(route, /if \('businessHours' in body\) \{\s*const parsed = businessHoursSchema\.safeParse\(body\.businessHours\)/)
    assert.match(route, /ownerTextProblem\(note, 'La nota fuera de horario'\)/)
    assert.match(route, /hasConfirmationWording\(note\) \|\| dealProblem\(note, \[\]\) \|\| headlineHasNumberWords\(note\)/)
    assert.match(route, /description: 'Horario de atención del agente'/)
    assert.match(read('src/app/config/agentes/page.tsx'), /<AgentBusinessHoursCard key=\{`hours-\$\{selected\.id\}`\}/)
  })
})
