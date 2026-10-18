/**
 * Sleeping Patches final report (2026-10-18), second batch: C7, C8, C9, C10 and the C4 base-cap rule. Each case pinned.
 * Pure helpers + small fakes; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/sleeping-exam-fixes-2.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPersonalDataEcho, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { REPAIRABLE_REASONS, repairInstruction } from '@/lib/soft-ai/llm/runtime'
import { deriveSalesState, salesAllowedAmounts, salesFreeShippingRule, type SalesContext } from '@/lib/soft-ai/sales-state'
import { coverageScenarios } from '@/lib/soft-ai/knowledge-coverage'
import { acquireTestLock, recordBaseCap, recordedBaseCap, releaseTestLock, type LockDb } from '../../../scripts/agent-pack/test-lock'

const SLEEP: SalesContext = {
  catalog: [{ name: 'SleepingPatches', price: 9900, stockLabel: 'disponible' }],
  shippingMethods: [{ name: 'Correos', price: 3000, coverage: 'todo el país', cod: 'no' }],
  orderFields: [],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['62019914'],
  promo: null,
  bundles: [
    { name: 'Pack 2 bolsas (60 noches)', price: 19800, shippingIncluded: true },
    { name: 'Pack 3 bolsas (90 noches)', price: 28500, shippingIncluded: true },
  ],
}
const quote = salesAllowedAmounts(SLEEP)
const rule = salesFreeShippingRule(SLEEP)!
const check = (text: string, customerText = '') => validateAgentOutput({ text, citedToolNames: [], quoteAmounts: quote, freeShippingRule: rule, customerText })

describe('C9: a reply that is only someone\'s personal data is never sent', () => {
  it('the night silent-trial reply (name / phone / place / address) is held, repairable', () => {
    const echo = 'María Pérez Solís\n8888-0000\nCartago, Oreamuno, San Rafael\n200 m norte de la iglesia, casa blanca'
    assert.equal(isPersonalDataEcho(echo), true)
    const v = check(echo)
    assert.ok(v.reasons.includes('data_echo'), String(v.reasons))
    assert.ok(REPAIRABLE_REASONS.has('data_echo'))
    assert.match(repairInstruction(['data_echo']), /datos personales/)
    for (const t of [
      'Nombre: Juan Rojas\nTeléfono: 8888-1234\nDirección: 100 m sur de la escuela',
      'Juan Rojas\n+506 8888 1234\njuan@example.com',
      '- Juan Rojas\n- 8888-1234\n- San José, Escazú',
    ]) {
      assert.equal(isPersonalDataEcho(t), true, t)
    }
  })
  it('the data-request list, an order summary, payment details and ordinary replies pass', () => {
    for (const t of [
      'Para coordinar el envío, pasame estos datos:\n- Nombre completo\n- Teléfono\n- Correo (opcional)\n- Provincia\n- Cantón\n- Distrito\n- Dirección exacta con señas',
      'Resumen del pedido:\n- Pack 2 bolsas: ₡19 800\n- Juan Rojas\n- 8888-1234\n- San José, Escazú',
      'SINPE Móvil: 6201 9914\nA nombre de: Rafael García',
      '¡Gracias, Juan! Ya tengo tus datos 😊\n¿Cómo preferís pagar?',
      'Juan Rojas',
      'Hola\n¿Cómo estás?',
    ]) {
      assert.equal(isPersonalDataEcho(t), false, t)
    }
  })
})

describe('C7: a customer who asks the price again gets it again', () => {
  it('"ya te lo compartí / ya te lo dije" is a repairable hold; a plain repeat passes', () => {
    for (const t of ['Ya te lo compartí arriba 😊', 'Como te dije, la bolsa cuesta ₡9 900', 'Ya se lo indiqué, cuesta ₡9 900.']) {
      const v = check(t)
      assert.ok(v.reasons.includes('repeat_refusal'), t)
    }
    assert.ok(REPAIRABLE_REASONS.has('repeat_refusal'))
    assert.equal(check('¡Claro! La bolsa cuesta ₡9 900 y el envío ₡3 000 😊').ok, true)
  })
  it('the cotizar instruction says to repeat price / shipping when asked again', () => {
    const s = deriveSalesState({ history: [{ id: '1', direction: 'outbound', content: 'La bolsa cuesta ₡9 900.', sentAt: '' }], inboundText: '¿y cuánto era?', ctx: SLEEP })
    assert.equal(s.stage, 'cotizar')
    assert.match(s.nextStep, /si el cliente los vuelve a preguntar, decíselos de nuevo/)
  })
})

describe('C8: ", y …" and a bracketed combo price no longer break the combo fact', () => {
  it('the exam shapes pass', () => {
    for (const t of [
      'Con 1 bolsa el envío cuesta ₡3 000, y el pack de 2 bolsas cuesta ₡19 800 con envío incluido.',
      'Con 1 bolsa son ₡3 000 de envío; con el pack de 2 bolsas (₡19 800) el envío va incluido.',
      'El envío cuesta ₡3 000 con 1 bolsa; con el pack de 2 bolsas (₡19 800) o el de 3 (₡28 500) el envío va incluido.',
      'Una bolsa cuesta ₡9 900 y el envío ₡3 000; el pack de 2 bolsas cuesta ₡19 800 con envío incluido.',
    ]) {
      const v = check(t)
      assert.equal(v.ok, true, `${t} → ${v.reasons}`)
    }
  })
  it('still blocked: a non-combo price in the fact, a bracketed non-combo price, personal / deal wording', () => {
    for (const t of [
      'La bolsa cuesta ₡9 900 con envío incluido.',
      'Con el pack de 2 bolsas (₡9 900) el envío va incluido.',
      'Te lo dejo en ₡9 900, y el pack de 2 bolsas cuesta ₡19 800 con envío incluido.',
      'Con 1 bolsa el envío cuesta ₡3 000, y a vos te lo mando con envío incluido.',
      'Con 1 bolsa el envío cuesta ₡3 000, y el pack de 2 bolsas cuesta ₡19 800 con envío incluido hoy.',
    ]) {
      assert.equal(check(t).ok, false, t)
    }
  })
})

describe('C10: the coverage check does not flag impersonal "no se + verb"', () => {
  const forbid = (coverageScenarios(['SleepingPatches'])[0].steps[0].expect?.forbidRegex ?? []).map((s) => new RegExp(s, /\\p\{/.test(s) ? 'iu' : 'i'))
  const flagged = (t: string) => forbid.some((re) => re.test(t))
  it('"no se aceptan" / "no se envía" pass; "no sé" / "no se exactamente" / "no se si" are flagged', () => {
    for (const t of ['No se aceptan devoluciones de producto abierto.', 'No se envía fuera del país.', 'No se recomienda en embarazo.', 'No se cobra el envío con el pack.']) assert.equal(flagged(t), false, t)
    for (const t of ['No sé, dejame consultar', 'no se exactamente', 'No se si hay', 'no sabría decirte', 'No se, dejame ver']) assert.equal(flagged(t), true, t)
  })
})

describe('C4: any run is refused while the cap is not at the business\'s normal value', () => {
  function fakeDb(): LockDb {
    const state: { row: { config: unknown } | null } = { row: null }
    const tx = {
      tenantFeatureFlag: {
        upsert: async (a: { create: { config: unknown } }) => {
          if (!state.row) state.row = { config: a.create.config }
        },
        update: async (a: { data: { config: unknown } }) => {
          state.row = { config: a.data.config }
        },
      },
      $queryRaw: async () => [{ config: state.row?.config }],
    }
    return { $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) } as unknown as LockDb
  }
  it('the base cap survives release and comes back on the next lock', async () => {
    const db = fakeDb()
    const a = await acquireTestLock(db, { tenantId: 't1', label: 'exam', cap: 2_000_000 })
    assert.equal(a.baseCap, undefined)
    await recordBaseCap(db, { tenantId: 't1', baseCap: 800_000 })
    await releaseTestLock(db, { tenantId: 't1', token: a.token })
    const b = await acquireTestLock(db, { tenantId: 't1', label: 'shoppers', cap: 3_000_000 })
    assert.equal(b.baseCap, 800_000)
    assert.equal(recordedBaseCap({ baseCap: 'x' }), null)
    assert.equal(recordedBaseCap(null), null)
  })
  it('test-session refuses when the cap differs from the base; restore and test-cap --restore record it', () => {
    const src = readFileSync('scripts/agent-pack/test-session.ts', 'utf8')
    assert.match(src, /lock\.baseCap !== undefined && before !== lock\.baseCap/)
    assert.ok(src.indexOf('lock.baseCap !== undefined') < src.indexOf('testDailyTokenCap: Math.max('))
    assert.match(src, /recordBaseCap\(lockDb, \{ tenantId, baseCap: before \}\)/)
    assert.match(readFileSync('scripts/agent-pack/test-cap.ts', 'utf8'), /recordBaseCap\(lockDb, \{ tenantId, baseCap: to \}\)/)
  })
})
