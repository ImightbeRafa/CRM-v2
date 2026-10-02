import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  K_MIN,
  buildFlowReport,
  classifyIntent,
  contentWords,
  reportToMarkdown,
  type ConversationRow,
} from '@/lib/flow-mining'

const row = (text: string, over: Partial<ConversationRow> = {}): ConversationRow => ({
  firstInboundText: text,
  firstInboundHourCR: 10,
  secondsToFirstReply: 120,
  ordered: false,
  secondsToOrder: null,
  ...over,
})

describe('intent classification (Costa Rican Spanish)', () => {
  it('maps common first messages', () => {
    assert.equal(classifyIntent('Hola, ¿cuánto sale?'), 'precio')
    assert.equal(classifyIntent('Precio del kit por favor'), 'precio')
    assert.equal(classifyIntent('¿Hacen envíos a Guanacaste?'), 'envio')
    assert.equal(classifyIntent('¿Dónde están ubicados?'), 'ubicacion')
    assert.equal(classifyIntent('Me pasa el SINPE?'), 'pago')
    assert.equal(classifyIntent('¿Cuándo llega mi pedido?'), 'estado_pedido')
    assert.equal(classifyIntent('Buenas tardes'), 'saludo_solo')
    assert.equal(classifyIntent('xyz'), 'otro')
    assert.equal(classifyIntent(''), 'otro')
  })
})

describe('report privacy', () => {
  it('drops anything seen fewer than K_MIN times and never carries digits', () => {
    const rows: ConversationRow[] = []
    for (let i = 0; i < K_MIN; i += 1) rows.push(row('Cuánto sale el parche?', { ordered: i < 2 }))
    rows.push(row('Mi número es 88887777 llamame', { ordered: true }))
    const report = buildFlowReport(rows)
    assert.equal(report.conversations, K_MIN + 1)
    assert.ok(report.byIntent.find((i) => i.intent === 'precio' && i.conversations === K_MIN))
    const md = reportToMarkdown(report, 'x')
    assert.doesNotMatch(md, /88887777/)
    assert.doesNotMatch(md, /llamame/) // appears once: below k
    assert.ok(report.suppressedBelowK >= 1)
  })
  it('phrases need K_MIN chats and carry only counts and rates', () => {
    const rows = Array.from({ length: K_MIN }, (_, i) => row('precio del kit', { ordered: i === 0 }))
    const report = buildFlowReport(rows)
    const p = report.topPhrases.find((x) => x.phrase === 'precio')
    assert.ok(p)
    assert.equal(p.conversations, K_MIN)
    assert.equal(p.conversionRate, 0.2)
    assert.equal(buildFlowReport(rows.slice(0, K_MIN - 1)).topPhrases.length, 0)
  })
  it('words with digits are not counted', () => {
    assert.deepEqual(contentWords('pedido 12345 de kit'), ['pedido', 'kit'])
  })
})

describe('report math', () => {
  it('computes medians and rates', () => {
    const rows = [
      row('precio', { secondsToFirstReply: 60, ordered: true, secondsToOrder: 7200 }),
      row('precio', { secondsToFirstReply: 180, ordered: true, secondsToOrder: 14400 }),
      row('precio', { secondsToFirstReply: null }),
    ]
    const r = buildFlowReport(rows, 1)
    assert.equal(r.replied, 2)
    assert.equal(r.ordered, 2)
    assert.equal(r.conversionRate, 0.667)
    assert.equal(r.medianSecondsToFirstReply, 120)
    assert.equal(r.medianHoursToOrder, 3)
  })
})

describe('script safety (static)', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/flow-mining.ts'), 'utf8')
  it('requires one tenant, reads only, and writes only to the gitignored reports folder', () => {
    assert.match(src, /Falta --tenant=/)
    assert.match(src, /statement_timeout = '60s'/)
    assert.doesNotMatch(src, /INSERT |UPDATE |DELETE |executeRawUnsafe|queryRawUnsafe/)
    assert.match(src, /\.reports/)
    assert.match(readFileSync(join(process.cwd(), '.gitignore'), 'utf8'), /^\.reports\/$/m)
  })
})

describe('review fixes', () => {
  it('currency symbols count as a price question', () => {
    assert.equal(classifyIntent('₡5000?'), 'precio')
    assert.equal(classifyIntent('tiene a $20'), 'precio')
  })
  it('the script is tracked, windows by the first message, and keeps output inside .reports', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/flow-mining.ts'), 'utf8')
    assert.match(src, /f\."sentAt" >= \$\{from\} AND f\."sentAt" < \$\{to\}/)
    assert.match(src, /replace\(\/\[\^A-Za-z0-9\._-\]\/g, '_'\)/)
    assert.match(readFileSync(join(process.cwd(), '.gitignore'), 'utf8'), /^!scripts\/flow-mining\.ts$/m)
  })
})
