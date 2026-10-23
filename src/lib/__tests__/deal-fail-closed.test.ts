/**
 * Deal check, fail closed (Rafael 2026-10-22, after the #128 exemption rounds): a reply that mentions a deal word is held
 * even when it says there is none; the check reads the raw text and the text as the customer reads it.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/deal-fail-closed.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dealProblem, dealReadForm } from '@/lib/soft-ai/llm/output-validator'

const ch = (...codes: number[]) => String.fromCharCode(...codes)

describe('deal check: fail closed', () => {
  it('a negated deal word is still held (a person clicks; no invented discount goes out)', () => {
    for (const t of ['No manejamos descuentos.', 'No tenemos promociones ni descuentos 😊', 'No manejamos descuentos, pero el combo sale ₡32 800', 'Sin descuento, el precio es ₡14 900']) {
      assert.equal(dealProblem(t, []), true, t)
    }
  })
  it('every offer the #128 review rounds found is held', () => {
    for (const t of [
      'Normalmente no damos descuentos, pero por ser tu primera compra sí.',
      'No damos descuentos. Pero a vos te lo hago',
      'No hay descuentos, pero el combo dos por uno sale ₡14 900.',
      'Por ahora no tenemos descuentos 😊\n\nSin embargo, por ser tu primer pedido, podemos hacer una excepción 🙌',
      '¡Hay descuento™ para vos!',
      '¡Hoy 2x1™ en todo!',
      `Te hago un des${ch(0xad)}cuento del 20% 😉`,
      `Tenemos descuento${ch(0xad)}para vos 😉`,
      'Te hago un 10% 😉',
      'Te dejo un 15%',
    ]) assert.equal(dealProblem(t, []), true, JSON.stringify(t))
  })
  it('ordinary replies are not deals', () => {
    for (const t of ['El kit sale ₡14 900 y el envío ₡3 000.', 'Es 100% algodón 😊', 'El retiro en tienda no tiene costo.', '¿Te lo aparto?']) {
      assert.equal(dealProblem(t, []), false, t)
    }
    assert.equal(dealReadForm(`des${ch(0xad)}cuento`), 'descuento')
  })
})
