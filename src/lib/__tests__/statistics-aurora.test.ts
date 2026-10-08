import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auroraComparisonRange,
  auroraPeriodRange,
  auroraPreviousRange,
  resolveAuroraPeriodSpec,
  averageTicket,
  barPercent,
  bucketPairedSeries,
  chartBucketSize,
  enumerateDateKeys,
  formatCompactMoney,
  formatDayLabel,
  formatDeltaLabel,
  formatExactMoney,
  formatRangeLabel,
  normalizeAuroraPeriod,
  pairDailySeries,
  pctDelta,
  periodCompareLabel,
  resolveAuroraPeriod,
  summarizeChatOrderLinks,
  evenTickIndices,
  safeCount,
  sharePercent,
} from '../statistics-aurora'

const BAD = /NaN|undefined|Infinity/

describe('statistics-aurora periods', () => {
  it('resolves only known periods; normalize falls back to 7d', () => {
    assert.equal(resolveAuroraPeriod('30d'), '30d')
    assert.equal(resolveAuroraPeriod('365d'), null)
    assert.equal(resolveAuroraPeriod(undefined), null)
    assert.equal(normalizeAuroraPeriod('nope'), '7d')
    assert.equal(normalizeAuroraPeriod('hoy'), 'hoy')
  })

  it('uses the Costa Rica day boundary (UTC-6)', () => {
    // 03:00Z on the 27th is still the 26th at 21:00 in Costa Rica.
    const now = new Date('2026-09-27T03:00:00Z')
    assert.equal(auroraPeriodRange('hoy', now).endDate, '2026-09-26')
  })

  it('ranges are inclusive with lengths 1 / 7 / 30 / 90', () => {
    const now = new Date('2026-09-26T18:00:00Z')
    for (const [period, len] of [['hoy', 1], ['7d', 7], ['30d', 30], ['90d', 90]] as const) {
      const r = auroraPeriodRange(period, now)
      assert.equal(r.endDate, '2026-09-26')
      assert.equal(enumerateDateKeys(r.startDate, r.endDate).length, len)
    }
    assert.equal(auroraPeriodRange('7d', now).startDate, '2026-09-20')
  })

  it('previous range is adjacent and the same length', () => {
    const now = new Date('2026-09-26T18:00:00Z')
    for (const period of ['hoy', '7d', '30d', '90d'] as const) {
      const cur = auroraPeriodRange(period, now)
      const prev = auroraPreviousRange(cur)
      assert.equal(
        enumerateDateKeys(prev.startDate, prev.endDate).length,
        enumerateDateKeys(cur.startDate, cur.endDate).length,
      )
      const after = enumerateDateKeys(prev.endDate, cur.startDate)
      assert.equal(after.length, 2, 'prev end and current start are consecutive days')
    }
    assert.deepEqual(auroraPreviousRange({ startDate: '2026-09-20', endDate: '2026-09-26' }), {
      startDate: '2026-09-13',
      endDate: '2026-09-19',
    })
  })

  it('compare label per period', () => {
    assert.equal(periodCompareLabel('hoy'), 'vs ayer')
    assert.equal(periodCompareLabel('7d'), 'vs 7 días anteriores')
    assert.equal(periodCompareLabel('semana'), 'vs mismos días de la semana pasada')
    assert.equal(periodCompareLabel('mes-pasado'), 'vs el mes anterior')
    assert.equal(periodCompareLabel({ period: 'custom', from: '2026-09-01', to: '2026-09-15' }), 'vs 15 días anteriores')
  })
})

describe('statistics-aurora calendar periods (Costa Rica, weeks start Monday)', () => {
  const thu = new Date('2026-10-08T18:00:00Z') // Thursday 8 Oct in Costa Rica
  const both = (period: Parameters<typeof auroraPeriodRange>[0], now: Date) => {
    const range = auroraPeriodRange(period, now)
    return { range, previous: auroraComparisonRange(period, range) }
  }

  it('ayer, esta semana, semana pasada', () => {
    assert.deepEqual(auroraPeriodRange('ayer', thu), { startDate: '2026-10-07', endDate: '2026-10-07' })
    assert.deepEqual(both('semana', thu), {
      range: { startDate: '2026-10-05', endDate: '2026-10-08' },
      previous: { startDate: '2026-09-28', endDate: '2026-10-01' },
    })
    assert.deepEqual(both('semana-pasada', thu), {
      range: { startDate: '2026-09-28', endDate: '2026-10-04' },
      previous: { startDate: '2026-09-21', endDate: '2026-09-27' },
    })
  })

  it('este mes compares with the same days of last month; mes pasado with the full month before', () => {
    assert.deepEqual(both('mes', thu), {
      range: { startDate: '2026-10-01', endDate: '2026-10-08' },
      previous: { startDate: '2026-09-01', endDate: '2026-09-08' },
    })
    assert.deepEqual(both('mes-pasado', thu), {
      range: { startDate: '2026-09-01', endDate: '2026-09-30' },
      previous: { startDate: '2026-08-01', endDate: '2026-08-31' },
    })
    // 31 March vs February: clamped to 28 Feb, never 3 March.
    assert.deepEqual(both('mes', new Date('2026-03-31T18:00:00Z')).previous, { startDate: '2026-02-01', endDate: '2026-02-28' })
  })

  it('week and month edges: Monday, Sunday night in Costa Rica, New Year', () => {
    assert.deepEqual(auroraPeriodRange('semana', new Date('2026-10-05T18:00:00Z')), { startDate: '2026-10-05', endDate: '2026-10-05' })
    // 03:00Z Monday = Sunday 21:00 in Costa Rica: still last week.
    assert.deepEqual(auroraPeriodRange('semana', new Date('2026-10-05T03:00:00Z')), { startDate: '2026-09-28', endDate: '2026-10-04' })
    const ny = new Date('2026-01-01T18:00:00Z')
    assert.deepEqual(auroraPeriodRange('semana', ny), { startDate: '2025-12-29', endDate: '2026-01-01' })
    assert.deepEqual(auroraPeriodRange('mes-pasado', ny), { startDate: '2025-12-01', endDate: '2025-12-31' })
    assert.deepEqual(auroraComparisonRange('mes', auroraPeriodRange('mes', ny)), { startDate: '2025-12-01', endDate: '2025-12-01' })
  })

  it('custom ranges: real dates, ordered, at most 366 days; compared with the adjacent range', () => {
    assert.deepEqual(resolveAuroraPeriodSpec('custom', '2026-09-01', '2026-09-15'), { period: 'custom', from: '2026-09-01', to: '2026-09-15' })
    assert.equal(resolveAuroraPeriodSpec('custom', '2026-09-15', '2026-09-01'), null)
    assert.equal(resolveAuroraPeriodSpec('custom', '2026-02-30', '2026-03-01'), null)
    assert.equal(resolveAuroraPeriodSpec('custom', '2025-01-01', '2026-09-01'), null)
    assert.equal(resolveAuroraPeriodSpec('custom', null, null), null)
    assert.deepEqual(resolveAuroraPeriodSpec('semana', 'x', 'y'), { period: 'semana' })
    const spec = { period: 'custom' as const, from: '2026-09-01', to: '2026-09-15' }
    assert.deepEqual(both(spec, thu), {
      range: { startDate: '2026-09-01', endDate: '2026-09-15' },
      previous: { startDate: '2026-08-17', endDate: '2026-08-31' },
    })
  })

  it('range label shows the year when a range crosses it', () => {
    assert.equal(formatRangeLabel('2025-12-29', '2026-01-04'), '29 dic 2025 – 4 ene 2026')
  })
})

describe('statistics-aurora delta math', () => {
  it('pctDelta is null when there is no previous base or input is not finite', () => {
    assert.equal(pctDelta(5, 0), null)
    assert.equal(pctDelta(0, 0), null)
    assert.equal(pctDelta(NaN, 1), null)
    assert.equal(pctDelta(1, Infinity), null)
    assert.equal(pctDelta(5, -3), null)
  })
  it('pctDelta computes growth and decline', () => {
    assert.equal(pctDelta(118, 100), 18)
    assert.equal(pctDelta(97, 100), -3)
    assert.equal(pctDelta(0, 100), -100)
  })
  it('delta label', () => {
    assert.equal(formatDeltaLabel(18.4), '+18%')
    assert.equal(formatDeltaLabel(-3.2), '−3%')
    assert.equal(formatDeltaLabel(0.2), '0%')
    assert.equal(formatDeltaLabel(null), '—')
    assert.equal(formatDeltaLabel(NaN), '—')
    assert.equal(formatDeltaLabel(Infinity), '—')
  })
  it('average ticket guards zero orders', () => {
    assert.equal(averageTicket(1000, 0), 0)
    assert.equal(averageTicket(1000, 4), 250)
    assert.equal(averageTicket(NaN, 4), 0)
  })
  it('share / bar percent guard zero totals', () => {
    assert.equal(sharePercent(3, 0), 0)
    assert.equal(sharePercent(1, 4), 25)
    assert.equal(barPercent(5, 0), 0)
    assert.equal(barPercent(50, 100), 50)
    assert.equal(barPercent(500, 100), 100)
  })
})

describe('statistics-aurora safe formatting', () => {
  it('formats compact money like STAT-01', () => {
    assert.equal(formatCompactMoney(2_480_000, '₡'), '₡2,48 M')
    assert.equal(formatCompactMoney(455_000, '₡'), '₡455 mil')
    assert.equal(formatCompactMoney(13_340, '₡'), '₡13.340')
    assert.equal(formatCompactMoney(0, '₡'), '₡0')
  })
  it('never prints NaN / undefined / Infinity', () => {
    for (const v of [NaN, Infinity, -Infinity, undefined as unknown as number, null as unknown as number]) {
      assert.doesNotMatch(formatCompactMoney(v, '₡'), BAD)
      assert.doesNotMatch(formatExactMoney(v, '₡'), BAD)
      assert.doesNotMatch(formatDeltaLabel(v), BAD)
      assert.doesNotMatch(String(safeCount(v)), BAD)
    }
    assert.equal(formatCompactMoney(NaN, '₡'), '₡0')
  })
  it('exact money groups with dots', () => {
    assert.equal(formatExactMoney(1_234_567, '₡'), '₡1.234.567')
  })
  it('day and range labels', () => {
    assert.equal(formatDayLabel('2026-09-20', 'weekday'), 'Dom')
    assert.equal(formatDayLabel('2026-09-26'), '26 sep')
    assert.equal(formatDayLabel('bad'), '')
    assert.equal(formatRangeLabel('2026-09-20', '2026-09-26'), '20–26 sep')
    assert.equal(formatRangeLabel('2026-08-28', '2026-09-26'), '28 ago – 26 sep')
    assert.equal(formatRangeLabel('2026-09-26', '2026-09-26'), '26 sep')
  })
})

describe('statistics-aurora pairDailySeries', () => {
  const range = { startDate: '2026-09-20', endDate: '2026-09-26' }
  const prev = auroraPreviousRange(range)
  it('zero-fills and keeps equal length', () => {
    const paired = pairDailySeries(
      [{ date: '2026-09-22', revenue: 500, orderCount: 2 }],
      [{ date: '2026-09-13', revenue: 300, orderCount: 1 }],
      range,
      prev,
    )
    assert.equal(paired.length, 7)
    assert.equal(paired[0].prevRevenue, 300)
    assert.equal(paired[0].revenue, 0)
    assert.equal(paired[2].revenue, 500)
    assert.equal(paired[2].orderCount, 2)
    assert.equal(paired[6].prevDate, '2026-09-19')
  })
  it('empty input still yields a full zero series', () => {
    const paired = pairDailySeries([], [], range, prev)
    assert.equal(paired.length, 7)
    assert.ok(paired.every((p) => p.revenue === 0 && p.prevRevenue === 0))
    assert.doesNotMatch(JSON.stringify(paired), BAD)
  })
})

describe('statistics-aurora chart buckets', () => {
  const range = { startDate: '2026-06-29', endDate: '2026-09-26' }
  const prev = auroraPreviousRange(range)
  it('keeps daily up to 31 days and sums weekly beyond', () => {
    assert.equal(chartBucketSize(30), 1)
    assert.equal(chartBucketSize(90), 7)
    const paired = pairDailySeries(
      [{ date: '2026-09-26', revenue: 100, orderCount: 1 }],
      [],
      range,
      prev,
    )
    const buckets = bucketPairedSeries(paired, 7)
    assert.equal(paired.length, 90)
    assert.equal(buckets.length, 13)
    assert.equal(buckets.reduce((a, b) => a + b.revenue, 0), 100)
    assert.equal(bucketPairedSeries(paired, 1), paired)
  })
})

describe('summarizeChatOrderLinks', () => {
  const orders = new Map([
    ['o1', { total: 10000, status: 'Pendiente', contraEntrega: false, cePaymentConfirmed: false, customFields: { paymentStatus: 'paid' } }],
    ['o2', { total: 5000, status: 'Pendiente', contraEntrega: false, cePaymentConfirmed: false, customFields: null }],
    ['o3', { total: 2000, status: 'Pendiente', contraEntrega: false, cePaymentConfirmed: false, customFields: { paymentStatus: 'paid' } }],
  ])

  it('no links -> nothing linked', () => {
    const r = summarizeChatOrderLinks([], orders, false)
    assert.equal(r.linkedOrders, 0)
    assert.equal(r.perLine.size, 0)
  })

  it('counts per line; booked mode sums every linked order', () => {
    const r = summarizeChatOrderLinks(
      [
        { orderId: 'o1', socialAccountId: 'wa' },
        { orderId: 'o2', socialAccountId: 'wa' },
        { orderId: 'o3', socialAccountId: 'ig' },
      ],
      orders,
      false,
    )
    assert.equal(r.linkedOrders, 3)
    assert.deepEqual(r.perLine.get('wa'), { orders: 2, revenue: 15000 })
    assert.deepEqual(r.perLine.get('ig'), { orders: 1, revenue: 2000 })
  })

  it('collected mode only counts revenue of paid orders (orders still counted)', () => {
    const r = summarizeChatOrderLinks(
      [
        { orderId: 'o1', socialAccountId: 'wa' },
        { orderId: 'o2', socialAccountId: 'wa' },
      ],
      orders,
      true,
    )
    assert.equal(r.perLine.get('wa')?.orders, 2)
    assert.equal(r.perLine.get('wa')?.revenue, 10000)
  })

  it('ignores orders outside the period map, null ids and duplicate links', () => {
    const r = summarizeChatOrderLinks(
      [
        { orderId: 'o1', socialAccountId: 'wa' },
        { orderId: 'o1', socialAccountId: 'ig' },
        { orderId: 'zzz', socialAccountId: 'wa' },
        { orderId: null, socialAccountId: 'wa' },
      ],
      orders,
      false,
    )
    assert.equal(r.linkedOrders, 1)
    assert.equal(r.perLine.get('ig'), undefined)
    assert.equal(r.perLine.get('wa')?.orders, 1)
  })
})

describe('evenTickIndices (x-axis label thinning)', () => {
  it('shows every label when there are few points', () => {
    assert.deepEqual(evenTickIndices(5, 8), [0, 1, 2, 3, 4])
    assert.deepEqual(evenTickIndices(0, 8), [])
  })
  it('caps at max, evenly spaced, keeping first and last', () => {
    for (const n of [12, 30, 31, 90]) {
      const ticks = evenTickIndices(n, 8)
      assert.ok(ticks.length <= 8, `n=${n}`)
      assert.equal(ticks[0], 0)
      assert.equal(ticks[ticks.length - 1], n - 1)
      const gaps = ticks.slice(1).map((t, i) => t - ticks[i])
      assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `even gaps n=${n}`)
    }
  })
  it('mobile cap of 4 is a subset-sized thinning', () => {
    assert.ok(evenTickIndices(30, 4).length <= 4)
    assert.deepEqual(evenTickIndices(30, 1), [0])
  })
})
