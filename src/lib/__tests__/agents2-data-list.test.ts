/**
 * Shipping data list (Rafael 2026-10-16, not negotiable): every shipping-data request an agent sends is the exact list
 * Nombre completo / Teléfono / Correo (opcional) / Provincia / Cantón / Distrito / Dirección exacta con señas.
 * Pure; no DB. Verifier round 1 cases (pickup, follow-ups, lookups, checklists, dot / slash / no-colon forms) included.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-data-list.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalizeOrderDataList, PICKUP_DATA_LIST, SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'
import { applyFinalOutputPolicy, messageLineCount } from '@/lib/soft-ai/llm/output-validator'
import { splitReplyParts } from '@/lib/soft-ai/reply-parts'
import { caseWhy } from '@/lib/soft-ai/test-engine/why'

const EXPECTED =
  '- Nombre completo\n- Teléfono\n- Correo (opcional)\n- Provincia\n- Cantón\n- Distrito\n- Dirección exacta con señas'

describe('canonicalizeOrderDataList', () => {
  it('the fixed lists are exactly what Rafael asked', () => {
    assert.equal(SHIPPING_DATA_LIST, EXPECTED)
    assert.equal(PICKUP_DATA_LIST, '- Nombre completo\n- Teléfono\n- Correo (opcional)')
  })

  it('rewrites the live PatchHouse reply (2026-10-16 screenshot) to the full list, lead-in kept', () => {
    const live = 'Para armar el pedido me pasás:\n\n- Nombre completo\n- Teléfono\n- Distrito\n- Correo\n- Dirección exacta con señas'
    assert.equal(canonicalizeOrderDataList(live), `Para armar el pedido me pasás:\n\n${EXPECTED}`)
  })

  it('rewrites other list wordings and bullet styles', () => {
    for (const list of [
      '- Nombre\n- Teléfono (si es otro distinto a este chat)\n- Provincia, cantón y distrito\n- Dirección exacta con otras señas',
      '• Nombre completo\n• Número de teléfono\n• Dirección exacta (provincia, cantón y distrito)',
      '1. Nombre completo\n2. Teléfono\n3. Correo electrónico\n4. Dirección',
      '- 👤 Nombre completo\n- 📞 Teléfono\n- 📍 Provincia / Cantón / Distrito\n- 📧 Correo\n- 🏠 Dirección exacta',
      '- *Nombre completo*\n- *Teléfono*\n- *Dirección*',
      // Blank lines between items: one list, one message.
      '- Nombre\n\n- Teléfono\n\n- Dirección',
      // A variant of a fixed field is replaced, never duplicated.
      '- Nombre completo\n- Teléfono\n- Dirección exacta y señas adicionales',
    ]) {
      assert.equal(canonicalizeOrderDataList(`Pasame estos datos:\n${list}`), `Pasame estos datos:\n${EXPECTED}`, list)
    }
  })

  it('rewrites inline requests: comma, slash, no colon and the old emoji saved reply', () => {
    for (const [input, lead] of [
      ['Para armar tu pedido pasame: nombre, teléfono y dirección exacta.', 'Para armar tu pedido pasame:'],
      ['Pasame: Nombre completo / Teléfono / Provincia / Cantón / Distrito / Dirección exacta con señas', 'Pasame:'],
      ['Para armar tu pedido necesito tu nombre completo, teléfono y dirección exacta 😊', 'Para armar tu pedido necesito:'],
      [
        '¡Perfecto! 🙌 Para preparar tu pedido me ayudas con: 👤 Nombre completo 📞 Teléfono 📍 Provincia / Cantón / Distrito 📧 Correo 🏠 Dirección exacta',
        '¡Perfecto! 🙌 Para preparar tu pedido me ayudas con:',
      ],
    ]) {
      assert.equal(canonicalizeOrderDataList(input), `${lead}\n${EXPECTED}`, input)
    }
  })

  it('ordinary lead-ins still get the fixed list (verifier round 2 M1)', () => {
    const wrong = '- Nombre\n- Teléfono\n- Distrito\n- Dirección exacta'
    for (const lead of [
      'Para confirmar tu pedido pasame:',
      'Para registrar tu pedido pasame:',
      'Para recibirlo en tu casa necesito:',
      'Sí, tenemos envío a Cartago 🚚 Para armar tu pedido pasame:',
      '¡Gracias por escribirnos! Para armar tu pedido pasame:',
      'Te lo anoto 😊 Pasame:',
    ]) {
      assert.equal(canonicalizeOrderDataList(`${lead}\n${wrong}`), `${lead}\n${EXPECTED}`, lead)
    }
    assert.equal(
      canonicalizeOrderDataList('Para confirmar tu pedido pasame: nombre, teléfono, distrito y dirección exacta.'),
      `Para confirmar tu pedido pasame:\n${EXPECTED}`,
    )
    // A 👍 / 👌 in the lead-in does not stop it.
    assert.equal(
      canonicalizeOrderDataList('¡Perfecto! 👌 Para armar tu pedido pasame: nombre, teléfono, provincia y dirección'),
      `¡Perfecto! 👌 Para armar tu pedido pasame:\n${EXPECTED}`,
    )
    // An earlier paragraph (no colon) is not the lead-in.
    assert.equal(
      canonicalizeOrderDataList(`El combo con envío queda en ₡20 900, te confirmo el total.\n\n${wrong}`),
      `El combo con envío queda en ₡20 900, te confirmo el total.\n\n${EXPECTED}`,
    )
  })

  it('business fields that only mention a fixed field are kept (M2)', () => {
    assert.equal(
      canonicalizeOrderDataList('Pasame:\n- Nombre completo\n- Teléfono\n- Dirección\n- Nombre de quien recibe'),
      `Pasame:\n${EXPECTED}\n- Nombre de quien recibe`,
    )
  })

  it('a product list in the next paragraph stays apart (L4)', () => {
    assert.equal(
      canonicalizeOrderDataList('Pasame:\n- Nombre\n- Teléfono\n- Dirección\n\n- Focus ₡9 900\n- Energy ₡9 900'),
      `Pasame:\n${EXPECTED}\n\n- Focus ₡9 900\n- Energy ₡9 900`,
    )
  })

  it('extra business fields stay after the list', () => {
    assert.equal(canonicalizeOrderDataList('Pasame:\n- Nombre\n- Teléfono\n- Dirección\n- Talla'), `Pasame:\n${EXPECTED}\n- Talla`)
    assert.equal(
      canonicalizeOrderDataList('Pasame:\n- Nombre completo\n- Teléfono\n- Dirección\n- Talla\n- Color'),
      `Pasame:\n${EXPECTED}\n- Talla\n- Color`,
    )
  })

  it('pickup lists (no place / address) are left as the agent wrote them', () => {
    for (const text of [
      `Perfecto. Pasame:\n${PICKUP_DATA_LIST}`,
      'Para el retiro me pasás:\n- Nombre\n- Teléfono\n- Correo',
      'Me pasás:\n- Nombre\n- Teléfono',
    ]) {
      assert.equal(canonicalizeOrderDataList(text), text, text)
    }
  })

  it('never touches summaries, checklists, follow-ups, lookups, invoices, contact channels, product / payment lists', () => {
    for (const text of [
      'Resumen:\n- Nombre: Ana Pérez\n- Teléfono: 8888 8888\n- Dirección: Oreamuno, Cartago',
      'Perfecto, ya tengo:\n- Nombre ✅\n- Teléfono ✅\n- Dirección ✅\n\nSolo me falta el distrito 😊',
      'Recibido ✔️\n- Nombre completo ✔️\n- Teléfono ✔️\n- Dirección ✔️',
      'Perfecto 😊\n✅ Nombre ✅ Teléfono ✅ Dirección',
      '✔️ Nombre completo ✔️ Teléfono ✔️ Provincia ✔️ Dirección',
      'Listo 👌\n- Nombre 👍\n- Teléfono 👍\n- Dirección 👍',
      'Solo me falta:\n- Teléfono\n- Dirección exacta',
      'Solo me falta: tu nombre y teléfono.',
      'Solo me falta:\n- Distrito\n- Correo',
      'Para buscar tu pedido pasame:\n- Nombre completo\n- Teléfono',
      'Para la factura electrónica necesito:\n- Nombre completo\n- Cédula\n- Correo',
      'Para el cambio pasame:\n- Nombre\n- Teléfono\n- Número de pedido',
      'Podés escribirnos por:\n- WhatsApp\n- Correo',
      'Atendemos por: WhatsApp, teléfono y correo',
      'Tenemos:\n- Focus ₡9 900\n- Energy ₡9 900\n- GLP-1 ₡9 900',
      'Podés pagar con:\n- SINPE Móvil\n- Tarjeta (en la web)',
      '¿Hacia dónde sería el envío, para verificar que llegamos a tu zona?',
      'Gracias Ana, ya tengo tu nombre y teléfono 😊',
      'Envío: GAM, Cartago y Heredia',
    ]) {
      assert.equal(canonicalizeOrderDataList(text), text, text)
    }
  })
})

describe('applyFinalOutputPolicy + the fixed list', () => {
  it('sends the fixed list; data_list is not blocking and the list is one message', () => {
    const policy = applyFinalOutputPolicy({
      text: 'Para armar el pedido me pasás:\n- Nombre completo\n- Teléfono\n- Distrito\n- Correo\n- Dirección exacta con señas',
      shortenLongReply: true,
    })
    assert.ok(policy.reasons.includes('data_list'))
    assert.ok(policy.ok, policy.reasons.join(','))
    assert.ok(policy.text.endsWith(EXPECTED))
    assert.ok(splitReplyParts(policy.text).some((p) => p.endsWith(EXPECTED)))
  })

  it('a dot-joined request is unjoined first, then made the fixed list', () => {
    const policy = applyFinalOutputPolicy({
      text: 'Para armar tu pedido pasame: Nombre completo · Teléfono · Distrito · Dirección exacta',
      shortenLongReply: true,
    })
    assert.equal(policy.text, `Para armar tu pedido pasame:\n${EXPECTED}`)
  })

  it('the fixed list + two business fields is never "too long" (no hand-off)', () => {
    for (const text of [
      `Para armar tu pedido pasame:\n${EXPECTED}\n- Cédula\n- Talla`,
      `Pasame:\n- Envío o retiro en tienda\n${EXPECTED}\n- Sabor (Menta/Fresa)`,
    ]) {
      const policy = applyFinalOutputPolicy({ text, shortenLongReply: true })
      assert.ok(!policy.reasons.includes('style_too_long'), policy.reasons.join(','))
      assert.ok(policy.ok, policy.reasons.join(','))
      assert.ok(messageLineCount(policy.text) <= 2)
    }
  })

  it('the 12-item allowance is only for a list holding the fixed list (L6)', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `- Producto ${i}`).join('\n')
    assert.equal(messageLineCount(nine), 9)
    assert.equal(messageLineCount(`${EXPECTED}\n- Cédula\n- Talla`), 1)
  })

  it('quick-check "why" treats data_list as benign', () => {
    assert.equal(caseWhy(['data_list']), null)
    assert.doesNotMatch(caseWhy(['data_list', 'style_too_long']) ?? '', /data_list/)
  })
})

describe('prompt + defaults', () => {
  it('the prompt names the fixed list and the default saved reply uses it', () => {
    const ctx = readFileSync('src/lib/soft-ai/agent-sales-context.ts', 'utf8')
    assert.match(ctx, /SHIPPING_DATA_FIELDS\.join/)
    assert.doesNotMatch(ctx, /Teléfono \(si es otro distinto a este chat\)/)
    const state = readFileSync('src/lib/soft-ai/sales-state.ts', 'utf8')
    assert.match(state, /oneLine\(f, 160\)/)
    assert.match(state, /lista fija de "Datos que necesita un pedido"/)
  })
})
