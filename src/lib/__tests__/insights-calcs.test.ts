import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatDurationEs, formatPercent, median, money, percentile, rate } from '../insights/stats-math'
import { adKey, buildAdSalesReport, lastTouchBefore, safeAdLink, withCampaignNames, type AdTouchRow } from '../insights/ad-sales'
import { buildTeamChatReport, isWaiting, readFirstResponseMs } from '../insights/team-chat-metrics'
import {
  buildReorderList,
  clampWindowDays,
  crWhatsAppHref,
  daysBetweenKeys,
  parseReorderRules,
  reorderLookbackDays,
  suggestedReorderMessage,
  unitsForRule,
  type ReorderOrderRow,
} from '../insights/reorder'
import {
  buildAgentPerformance,
  classifyOrderSale,
  handoffReasonLabel,
  isProviderError,
  type AgentTurnFact,
} from '../insights/agent-performance'

const d = (iso: string) => new Date(iso)

describe('stats-math', () => {
  it('median / percentile / rate never return NaN', () => {
    assert.equal(median([]), null)
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 2, 3]), 2.5)
    assert.equal(percentile([], 0.9), null)
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9)
    assert.equal(percentile([5], 0.9), 5)
    assert.equal(percentile([1, Number.NaN, 3], 0.5), 1)
    assert.equal(rate(1, 0), null)
    assert.equal(rate(1, 4), 0.25)
    assert.equal(money(-5), 0)
    assert.equal(money('12'), 12)
    assert.equal(money(Number.POSITIVE_INFINITY), 0)
  })
  it('formats durations and percents in plain Spanish', () => {
    assert.equal(formatDurationEs(null), '—')
    assert.equal(formatDurationEs(45_000), '45 s')
    assert.equal(formatDurationEs(4 * 60_000), '4 min')
    assert.equal(formatDurationEs(65 * 60_000), '1 h 05 min')
    assert.equal(formatDurationEs(27 * 3_600_000), '1 d 3 h')
    assert.equal(formatPercent(0.456), '46 %')
    assert.equal(formatPercent(null), '—')
  })
})

describe('ad → chat → sale', () => {
  const range = { start: d('2026-10-01T06:00:00Z'), end: d('2026-10-08T05:59:59Z') }
  const touch = (conversationId: string, sourceId: string | null, at: string, platform: 'whatsapp' | 'instagram' = 'whatsapp', headline = 'Parches'): AdTouchRow => ({
    conversationId,
    platform,
    sourceId,
    sourceUrl: sourceId ? `https://fb.me/${sourceId}` : null,
    headline,
    occurredAt: d(at),
  })

  it('keys ads by id, then link, then headline', () => {
    assert.equal(adKey({ sourceId: '123', sourceUrl: 'x', headline: 'y' }), 'ad:123')
    assert.equal(adKey({ sourceId: null, sourceUrl: 'https://a', headline: 'y' }), 'url:https://a')
    assert.equal(adKey({ sourceId: ' ', sourceUrl: null, headline: 'Hola' }), 'headline:hola')
  })

  it('last touch is the latest one at or before the order', () => {
    const touches = [touch('c1', 'A', '2026-10-01T10:00:00Z'), touch('c1', 'B', '2026-10-03T10:00:00Z'), touch('c1', 'C', '2026-10-05T10:00:00Z')]
    assert.equal(lastTouchBefore(touches, d('2026-10-04T00:00:00Z'))?.sourceId, 'B')
    assert.equal(lastTouchBefore(touches, d('2026-09-30T00:00:00Z')), null)
    // 7-day window by default; wider when asked
    assert.equal(lastTouchBefore(touches, d('2026-10-15T00:00:00Z')), null)
    assert.equal(lastTouchBefore(touches, d('2026-10-15T00:00:00Z'), 28)?.sourceId, 'C')
  })

  it('attributes orders to the last ad before the order, organic otherwise', () => {
    const report = buildAdSalesReport({
      touches: [
        touch('c1', 'A', '2026-10-02T10:00:00Z'),
        touch('c1', 'B', '2026-10-04T10:00:00Z'),
        touch('c2', 'A', '2026-10-03T10:00:00Z', 'instagram'),
        // touch AFTER the order must not get the sale
        touch('c3', 'B', '2026-10-06T10:00:00Z'),
        // touch older than the 7-day window → the order is "sin anuncio"
        touch('c4', 'A', '2026-09-20T10:00:00Z'),
        // touch before the period but inside the window → attributes, no chat in range
        touch('c7', 'A', '2026-09-30T10:00:00Z'),
      ],
      chats: [
        { id: 'c1', platform: 'whatsapp', createdAt: d('2026-10-02T10:00:00Z') },
        { id: 'c3', platform: 'whatsapp', createdAt: d('2026-10-02T10:00:00Z') },
        { id: 'c5', platform: 'whatsapp', createdAt: d('2026-10-02T10:00:00Z') },
        { id: 'c6', platform: 'instagram', createdAt: d('2026-10-02T10:00:00Z') },
      ],
      orders: [
        { id: 'o1', conversationId: 'c1', platform: 'whatsapp', createdAt: d('2026-10-05T10:00:00Z'), total: 20000, collected: true, cancelled: false },
        { id: 'o2', conversationId: 'c2', platform: 'instagram', createdAt: d('2026-10-04T10:00:00Z'), total: 10000, collected: false, cancelled: false },
        { id: 'o3', conversationId: 'c3', platform: 'whatsapp', createdAt: d('2026-10-05T10:00:00Z'), total: 5000, collected: true, cancelled: false },
        { id: 'o4', conversationId: 'c4', platform: 'whatsapp', createdAt: d('2026-10-05T10:00:00Z'), total: 7000, collected: true, cancelled: false },
        { id: 'o6', conversationId: 'c7', platform: 'whatsapp', createdAt: d('2026-10-05T10:00:00Z'), total: 3000, collected: true, cancelled: false },
        { id: 'o5', conversationId: 'c5', platform: 'whatsapp', createdAt: d('2026-10-05T10:00:00Z'), total: 9999, collected: true, cancelled: true },
        // the same order twice (two linking messages) counts once
        { id: 'o1', conversationId: 'c1', platform: 'whatsapp', createdAt: d('2026-10-05T10:00:00Z'), total: 20000, collected: true, cancelled: false },
      ],
      withoutChat: { orders: 2, paidOrders: 1, booked: 1000, collected: 400 },
      cancelled: { orders: 1, paidOrders: 0, booked: 9999, collected: 0 },
      range,
    })
    const a = report.rows.find((r) => r.adId === 'A')!
    const b = report.rows.find((r) => r.adId === 'B')!
    assert.equal(a.chats, 2) // c1 + c2 in range (c4's touch is before the period)
    assert.equal(a.orders, 2) // o2 (c2) + o6 (c7, touch 5 days before the order, before the period)
    assert.equal(a.booked, 13000)
    assert.equal(a.paidOrders, 1)
    assert.equal(a.collected, 3000)
    assert.deepEqual([...a.platforms].sort(), ['instagram', 'whatsapp'])
    assert.equal(b.chats, 2) // c1 + c3
    assert.equal(b.orders, 1) // o1 only (c3's touch came after its order)
    assert.equal(b.conversion, 0.5)
    // organic: c5 + c6 created in range with no touch; o3 (touch after order) + o4 (touch too old); o5 cancelled
    assert.equal(report.organic.chats, 2)
    assert.equal(report.organic.orders, 2)
    assert.equal(report.organic.booked, 12000)
    assert.equal(report.totals.adChatsDistinct, 3) // c1, c2, c3
    // partition: ads + sin anuncio + sin chat + cancelados = every order of the period (as the Resumen counts)
    assert.equal(report.totals.orders, 2 + 1 + 2 + 2 + 1)
    assert.equal(report.totals.booked, 13000 + 20000 + 12000 + 1000 + 9999)
    assert.equal(report.cancelled.orders, 1)
    assert.equal(report.withoutChat.orders, 2)
  })

  it('filters by channel', () => {
    const report = buildAdSalesReport({
      touches: [touch('c1', 'A', '2026-10-02T10:00:00Z'), touch('c2', 'A', '2026-10-03T10:00:00Z', 'instagram')],
      chats: [],
      orders: [{ id: 'o2', conversationId: 'c2', platform: 'instagram', createdAt: d('2026-10-04T10:00:00Z'), total: 10, collected: false, cancelled: false }],
      range,
      platform: 'whatsapp',
    })
    assert.equal(report.rows[0].chats, 1)
    assert.equal(report.rows[0].orders, 0)
    assert.equal(report.organic.orders, 0)
    assert.equal(report.withoutChat.orders, 0)
    assert.equal(report.cancelled.orders, 0)
  })

  it('campaign names come from the adapter; only http(s) links render', () => {
    const report = buildAdSalesReport({ touches: [touch('c1', 'A', '2026-10-02T10:00:00Z')], chats: [], orders: [], range })
    assert.equal(report.rows[0].campaignName, null)
    assert.equal(withCampaignNames(report, new Map([['A', 'Octubre']])).rows[0].campaignName, 'Octubre')
    assert.equal(safeAdLink('javascript:alert(1)'), null)
    assert.equal(safeAdLink('https://fb.me/x'), 'https://fb.me/x')
    // forged referral links outside Meta stay plain text
    assert.equal(safeAdLink('https://evil.example/fb.me'), null)
    assert.equal(safeAdLink('http://facebook.com/x'), null)
    assert.equal(safeAdLink('not a url'), null)
  })

  it('empty input → zeros, no NaN', () => {
    const report = buildAdSalesReport({ touches: [], chats: [], orders: [], range })
    assert.equal(report.rows.length, 0)
    assert.equal(report.organic.conversion, null)
    assert.doesNotMatch(JSON.stringify(report), /NaN|Infinity/)
  })
})

describe('team chat metrics', () => {
  const now = d('2026-10-22T18:00:00Z')
  it('waiting = the customer wrote last', () => {
    assert.equal(isWaiting({ lastInboundAt: d('2026-10-22T10:00:00Z'), lastOutboundAt: null }), true)
    assert.equal(isWaiting({ lastInboundAt: d('2026-10-22T10:00:00Z'), lastOutboundAt: d('2026-10-22T11:00:00Z') }), false)
    assert.equal(isWaiting({ lastInboundAt: null, lastOutboundAt: d('2026-10-22T11:00:00Z') }), false)
  })
  it('first response median / p90 by channel and teammate, backlog and chat → sale', () => {
    const report = buildTeamChatReport({
      firstResponses: [
        { userId: 'u1', channel: 'whatsapp', ms: 60_000 },
        { userId: 'u1', channel: 'whatsapp', ms: 120_000 },
        { userId: 'u2', channel: 'instagram', ms: 600_000 },
        { userId: 'u2', channel: 'whatsapp', ms: -5 },
      ],
      openChats: [
        { channel: 'whatsapp', assignedUserId: 'u1', lastInboundAt: d('2026-10-22T16:00:00Z'), lastOutboundAt: null },
        { channel: 'whatsapp', assignedUserId: null, lastInboundAt: d('2026-10-22T17:00:00Z'), lastOutboundAt: d('2026-10-22T16:00:00Z') },
        { channel: 'instagram', assignedUserId: 'u2', lastInboundAt: d('2026-10-22T10:00:00Z'), lastOutboundAt: d('2026-10-22T11:00:00Z') },
      ],
      repliesByUser: new Map([['u1', 12], ['u3', 2]]),
      chatsStartedByChannel: new Map([['whatsapp', 10]]),
      linkedOrdersByChannel: new Map([['whatsapp', 3], ['instagram', 1]]),
      teamUserIds: ['u4'],
      now,
    })
    const wa = report.channels.find((c) => c.channel === 'whatsapp')!
    const ig = report.channels.find((c) => c.channel === 'instagram')!
    assert.equal(wa.firstResponseMedianMs, 90_000)
    assert.equal(wa.firstResponseSamples, 2)
    assert.equal(wa.waiting, 2)
    assert.equal(wa.oldestWaitingMs, 2 * 3_600_000)
    assert.equal(wa.chatToSale, 0.3)
    assert.equal(ig.chatToSale, null) // no chats started → no rate
    assert.equal(ig.waiting, 0)
    const u1 = report.teammates.find((t) => t.userId === 'u1')!
    assert.equal(u1.openAssigned, 1)
    assert.equal(u1.waitingAssigned, 1)
    assert.equal(u1.replies, 12)
    assert.ok(report.teammates.some((t) => t.userId === 'u4'))
    assert.equal(report.overall.waitingUnassigned, 1)
    assert.equal(report.overall.samples, 3)
  })
  it('reads only sane ms from props', () => {
    assert.equal(readFirstResponseMs({ ms: 5 }), 5)
    assert.equal(readFirstResponseMs({ ms: '5' }), null)
    assert.equal(readFirstResponseMs([]), null)
    assert.equal(readFirstResponseMs({ ms: -1 }), null)
  })
})

describe('reorder reminders', () => {
  const rules = parseReorderRules([
    { id: 'r1', label: 'Parches x30', match: 'parches', daysPerUnit: 30 },
    { id: 'r2', label: 'Almohada', inventoryItemId: 'inv_1', match: null, daysPerUnit: 180 },
    { id: 'bad id!', label: 'x', match: 'x', daysPerUnit: 30 },
    { id: 'r3', label: '', match: 'x', daysPerUnit: 30 },
    { id: 'r4', label: 'Sin match', daysPerUnit: 30 },
    { id: 'r5', label: 'Too long', match: 'x', daysPerUnit: 9999 },
    { id: 'r1', label: 'dup', match: 'x', daysPerUnit: 3 },
  ])
  const order = (o: Partial<ReorderOrderRow> & { id: string; dateKey: string }): ReorderOrderRow => ({
    orderNumber: o.id,
    clientId: 'cl1',
    customerName: 'María Pérez',
    phone: '8888-7777',
    product: 'Parches de dormir',
    quantity: 1,
    allocations: [],
    ...o,
  })

  it('keeps only valid rules', () => {
    assert.deepEqual(rules.map((r) => r.id), ['r1', 'r2'])
    assert.equal(parseReorderRules('nope').length, 0)
    assert.equal(parseReorderRules([{ id: 'a', label: '<b>Hi</b>', match: 'p', daysPerUnit: '15' }])[0].label, 'bHi/b')
    assert.equal(parseReorderRules([{ id: 'a', label: 'Par‮ches​', match: 'p', daysPerUnit: 15 }])[0].label, 'Parches')
  })

  it('counts units by inventory item first, then by text', () => {
    assert.equal(unitsForRule({ product: 'PARCHES', quantity: 2, allocations: [] }, rules[0]), 2)
    assert.equal(unitsForRule({ product: 'Párches', quantity: 0, allocations: [] }, rules[0]), 1)
    assert.equal(unitsForRule({ product: 'Almohada', quantity: 1, allocations: [{ inventoryItemId: 'inv_1', quantity: 2 }] }, rules[1]), 2)
    assert.equal(unitsForRule({ product: 'Almohada', quantity: 1, allocations: [] }, rules[1]), 0)
  })

  it('lists customers who run out in the window, from their latest order', () => {
    const list = buildReorderList({
      rules,
      todayKey: '2026-10-22',
      windowDays: 7,
      overdueDays: 14,
      orders: [
        order({ id: '1', dateKey: '2026-08-01' }),
        order({ id: '2', dateKey: '2026-09-25' }), // runs out 10-25 → 3 days left
        order({ id: '3', dateKey: '2026-09-01', clientId: 'cl2', customerName: '@ana', quantity: 1 }), // 10-01 → 21 days ago → out of overdue window
        order({ id: '4', dateKey: '2026-09-15', clientId: 'cl3', customerName: 'Luis', quantity: 1 }), // 10-15 → -7
        order({ id: '5', dateKey: '2026-10-20', clientId: 'cl4', customerName: 'Eva' }), // 11-19 → too far
        order({ id: '6', dateKey: '2026-09-01', clientId: 'cl5', customerName: 'Sol', quantity: 2 }), // 60 days → 10-31 → 9 left → outside 7
      ],
    })
    assert.deepEqual(list.map((r) => [r.lastOrderNumber, r.daysLeft]), [['4', -7], ['2', 3]])
    assert.match(list[1].suggestedMessage, /María/)
    assert.match(list[0].suggestedMessage, /ya se le deben haber terminado/)
  })

  it('helpers', () => {
    assert.equal(daysBetweenKeys('2026-10-22', '2026-10-25'), 3)
    assert.equal(clampWindowDays('999'), 60)
    assert.equal(clampWindowDays('abc'), 7)
    // a missing param is the fallback, not 0 (Verifier: "already ran out" rows were dropped)
    assert.equal(clampWindowDays(null, 14), 14)
    assert.equal(clampWindowDays('', 14), 14)
    assert.equal(clampWindowDays('0', 14), 0)
    assert.ok(reorderLookbackDays(rules, 14) >= 180 * 2)
    assert.doesNotMatch(suggestedReorderMessage('@x', 'Parches', 2), /@x/)
    assert.equal(crWhatsAppHref('8888-7777'), 'https://wa.me/50688887777')
    assert.equal(crWhatsAppHref('+506 6123 4567', 'Hola á'), 'https://wa.me/50661234567?text=Hola%20%C3%A1')
    assert.equal(crWhatsAppHref('1234-5678'), null) // not a CR mobile/landline prefix
    assert.equal(crWhatsAppHref('+1 305 555 1234'), null)
    assert.equal(crWhatsAppHref(null), null)
  })
})

describe('agent performance', () => {
  const turn = (o: Partial<AgentTurnFact> & { doneAt: Date }): AgentTurnFact => ({
    agentId: 'a1',
    conversationId: 'c1',
    status: 'delivered',
    errorCode: null,
    costMicros: 1000,
    triggerAt: null,
    handoffKind: null,
    handoffReason: null,
    ...o,
  })

  it('provider errors and labels', () => {
    assert.equal(isProviderError('LLM_ERROR'), true)
    assert.equal(isProviderError('partial_delivery'), false)
    assert.equal(handoffReasonLabel('payment'), 'Comprobante o pago')
    assert.equal(handoffReasonLabel('weird'), 'Otro motivo')
    assert.equal(handoffReasonLabel('unknown_answer'), 'No tenía la respuesta')
    assert.equal(handoffReasonLabel('ai_allowance'), 'Se acabó el saldo de IA')
  })

  it('classifies who closed the sale', () => {
    const orderAt = d('2026-10-10T12:00:00Z')
    const t1 = turn({ doneAt: d('2026-10-10T10:00:00Z') })
    // replied, but no sale hand-off → the team finished it
    assert.equal(classifyOrderSale({ createdAt: orderAt }, [t1])?.kind, 'agent_human')
    // the sale hand-off (order ready / payment) → the agent closed it
    const ready = turn({ doneAt: d('2026-10-10T10:30:00Z'), handoffKind: 'handoff', handoffReason: 'order_ready' })
    assert.equal(classifyOrderSale({ createdAt: orderAt }, [t1, ready])?.kind, 'agent')
    // a later non-sale hand-off wins over an earlier sale one
    const complaint = turn({ doneAt: d('2026-10-10T11:00:00Z'), handoffKind: 'handoff', handoffReason: 'complaint' })
    assert.equal(classifyOrderSale({ createdAt: orderAt }, [t1, ready, complaint])?.kind, 'agent_human')
    // turns before the chat's previous order, or older than 7 days, do not count
    assert.equal(classifyOrderSale({ createdAt: orderAt, previousOrderAt: d('2026-10-10T11:00:00Z') }, [t1, ready]), null)
    assert.equal(classifyOrderSale({ createdAt: orderAt }, [turn({ doneAt: d('2026-10-01T10:00:00Z') })]), null)
    // no agent reply before the order → not an agent sale
    assert.equal(classifyOrderSale({ createdAt: orderAt }, [turn({ doneAt: d('2026-10-10T13:00:00Z') })]), null)
    assert.equal(classifyOrderSale({ createdAt: orderAt }, [turn({ doneAt: d('2026-10-10T10:00:00Z'), status: 'skipped' })]), null)
  })

  it('aggregates chats, replies, hand-offs, sales, cost and response time', () => {
    const rows = buildAgentPerformance({
      turns: [
        turn({ doneAt: d('2026-10-10T10:00:10Z'), triggerAt: d('2026-10-10T10:00:00Z') }),
        turn({ doneAt: d('2026-10-10T10:05:30Z'), triggerAt: d('2026-10-10T10:05:00Z'), handoffKind: 'handoff', handoffReason: 'payment' }),
        turn({ conversationId: 'c2', doneAt: d('2026-10-10T11:00:00Z'), status: 'failed', errorCode: 'LLM_ERROR', costMicros: 0 }),
        turn({ conversationId: 'c2', doneAt: d('2026-10-10T11:01:00Z'), handoffKind: 'review', handoffReason: 'review' }),
        turn({ agentId: 'a2', conversationId: 'c3', doneAt: d('2026-10-10T09:00:00Z'), costMicros: 500 }),
      ],
      orders: [
        { orderId: 'o1', conversationId: 'c1', createdAt: d('2026-10-10T12:00:00Z'), total: 20000, collected: true, cancelled: false },
        { orderId: 'o2', conversationId: 'c3', createdAt: d('2026-10-10T12:00:00Z'), total: 5000, collected: false, cancelled: false },
        { orderId: 'o3', conversationId: 'c9', createdAt: d('2026-10-10T12:00:00Z'), total: 5000, collected: false, cancelled: false },
      ],
    })
    const a1 = rows.find((r) => r.agentId === 'a1')!
    const a2 = rows.find((r) => r.agentId === 'a2')!
    assert.equal(a1.chats, 2) // c1 + c2 (c2 has a delivered review turn; its failed turn alone would not count)
    assert.equal(a1.replies, 3)
    assert.equal(a1.handoffs, 1)
    assert.equal(a1.reviews, 1)
    assert.deepEqual(a1.handoffReasons, [{ reason: 'payment', count: 1 }, { reason: 'review', count: 1 }])
    assert.equal(a1.providerErrors, 1)
    assert.equal(a1.salesByAgent, 1)
    assert.equal(a1.soldByAgent, 20000)
    assert.equal(a1.collected, 20000)
    assert.equal(a1.costMicros, 3000)
    assert.equal(a1.costPerSaleMicros, 3000)
    assert.equal(a1.responseMedianMs, 20_000)
    assert.equal(a2.salesWithHuman, 1)
    assert.equal(a2.soldWithHuman, 5000)
    assert.equal(a2.costPerSaleMicros, 500)
    assert.doesNotMatch(JSON.stringify(rows), /NaN|Infinity/)
  })
})
