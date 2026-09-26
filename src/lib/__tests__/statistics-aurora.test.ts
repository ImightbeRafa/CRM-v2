import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auroraPeriodRange,
  auroraPreviousRange,
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
