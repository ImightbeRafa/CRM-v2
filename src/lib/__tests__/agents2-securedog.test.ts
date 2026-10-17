/**
 * Agentes IA 2.0 Phase 1 — SecureDog release review 2026-10-15 regressions (INT-93..99, MEDIA-14).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPaymentText } from '@/lib/soft-ai/payment-classifier'
import { validateAgentOutput, shortenToMaxLines } from '@/lib/soft-ai/llm/output-validator'
import { planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { modelHandoff } from '@/lib/soft-ai/llm/runtime'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { PERIODIC_REARM_SKIP_REASONS } from '@/lib/soft-ai/waiting-sweep'

const read = (p: string) => readFileSync(p, 'utf8')

describe('INT-93: payment claims never reach a confirming reply', () => {
  it('questions about the state of a payment stay with a person (classifier)', () => {
    for (const t of [
      '¿Se acreditó el pago?',
      '¿El pago se aplicó?',
      '¿Se procesó mi pago?',
      '¿Mi sinpe es válido?',
      '¿Hay algún problema con mi pago?',
      'hola, ¿es normal que el sinpe no aparezca todavía?',
      '¿Es este el número para el sinpe? Ya lo envié',
      'Confirmame que lo recibieron porfa',
      'Me confirman cuando les entre',
      '¿me confirmás?',
      'Revisen porfa',
    ]) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('a short "yes it arrived" reply to a payment message is blocked as payment_status_claim', () => {
    for (const reply of ['Sí, ya se acreditó 😊', 'Sí, ya nos llegó', 'Sí, lo recibimos', 'Todo en orden con tu sinpe', 'Sí, el pago es correcto', 'Ya lo vimos, todo bien', 'Sí, se aplicó correctamente']) {
      const v = validateAgentOutput({ text: reply, citedToolNames: [], customerText: '¿Se acreditó el pago?' })
      assert.ok(v.reasons.includes('payment_status_claim'), reply)
    }
    // Delivery wording to a payment-method question is fine.
    assert.ok(!validateAgentOutput({ text: 'Aceptamos tarjeta en la web 😊 Te llega en 2 a 4 días', citedToolNames: [], customerText: '¿Aceptan tarjeta para el pago?' }).reasons.includes('payment_status_claim'))
    // No payment word in the customer message → not checked.
    assert.ok(!validateAgentOutput({ text: 'Sí, lo recibimos ayer en bodega', citedToolNames: [], customerText: '¿tienen stock?' }).reasons.includes('payment_status_claim'))
  })
  it('a payment-sounding reply is a real PAYMENT hand-off: fixed text, chat goes to a person', () => {
    assert.deepEqual(modelHandoff('payment_claim', '¿Se acreditó el pago?').kind, 'handoff')
    const plan = planModelTurnDelivery({
      text: 'Sí, ya se acreditó 😊',
      textOk: false,
      llmHandoff: modelHandoff('payment_claim', '¿Se acreditó el pago?'),
      llmEscalateReason: 'payment_claim',
      paymentDataByTeam: true,
    } as never)
    assert.equal(plan.text, SAFE_LINE.payment)
    assert.equal(plan.handoff?.kind, 'handoff')
    const runtime = read('src/lib/soft-ai/llm/runtime.ts')
    assert.match(runtime, /validation\.reasons\.includes\('confirmation_wording'\)/)
    assert.match(runtime, /validation\.reasons\.includes\('payment_status_claim'\)/)
    // SecureDog r9 F2: the customer side is the whole recent burst + the store's last message.
    assert.match(runtime, /structured\.needsHuman && \(hasPaymentWord\(customerSide\) \|\| hasPaymentWord\(lastStoreText\)\)/)
    assert.match(runtime, /const customerSide = burstCustomerText\(input\.history, input\.inboundText \|\| ''\)/)
    // SecureDog round 6 (luna-10): the reply check reads the whole burst since the store last wrote.
    assert.match(runtime, /customerText: burstCustomerText\(input\.history, input\.inboundText\)/)
  })
  it('a media caption with a confirm/review verb is a receipt', () => {
    const d = decideInbound({ inboundText: 'revisen porfa', messageType: 'image', brandFacts: { schemaVersion: 1 }, shortcuts: RESERVED_SHORTCUT_SEEDS.map((s) => ({ ...s, isActive: true, sortOrder: 0 })) } as never)
    assert.equal(d.escalate, true)
    assert.equal(d.shortcutKey, 'sys_handoff_media')
  })
})

describe('INT-94: multi-unit totals are never quotable', () => {
  it('the allowlist wiring has no quantity totals', () => {
    assert.doesNotMatch(read('src/lib/soft-ai/agent-turn-inputs.ts'), /salesQuantityAmounts\(/)
  })
})

describe('MEDIA-14: a media caption asking for a person is an opt-out', () => {
  it('opt-out wins over "¿Me contás por escrito?"', () => {
    for (const caption of ['quiero hablar con una persona', 'STOP', 'no quiero un bot']) {
      const d = decideInbound({ inboundText: caption, messageType: 'image', brandFacts: { schemaVersion: 1 }, shortcuts: RESERVED_SHORTCUT_SEEDS.map((s) => ({ ...s, isActive: true, sortOrder: 0 })) } as never)
      assert.equal(d.shortcutKey, 'sys_handoff_optout', caption)
      assert.equal(d.escalate, true, caption)
    }
  })
})

describe('INT-95..99 hardening', () => {
  it('INT-95: OFF voids a passing check; activation re-checks before and after its write', () => {
    const src = read('src/lib/soft-ai/agent-activation.ts')
    assert.match(src, /recordRunActivation\(input\.tenantId, latest\.id, \{ ok: false, code: 'OFF' \}\)/)
    assert.equal(src.match(/runVoidedByOff\(run\.tenantId, run\.id\)/g)?.length, 2)
  })
  it('INT-96: Devolver a IA route is same-origin and rate-limited', () => {
    const src = read('src/app/api/chat/soft-ai/control/route.ts')
    assert.match(src, /isSameOriginRequest\(request\)/)
    assert.match(src, /controlRateLimit\(/)
  })
  it('INT-97: the chat-automation cron honours DISABLE_CRONS', () => {
    assert.match(read('src/app/api/cron/chat-automation/route.ts'), /if \(cronsDisabled\(process\.env\)\)/)
  })
  it('INT-98: the periodic sweep never re-answers kill-switch / AI-terms skips; only messages after the line was on', () => {
    assert.equal(PERIODIC_REARM_SKIP_REASONS.has('kill_switch'), false)
    assert.equal(PERIODIC_REARM_SKIP_REASONS.has('ai_terms_not_accepted'), false)
    assert.match(read('src/lib/soft-ai/waiting-sweep.ts'), /notBeforeMs: passedAt/)
  })
  it('INT-99: shortening never drops a qualifying line', () => {
    const long = 'Hola 😊\nEl Focus está en ₡9.900\nmás el envío de ₡3.000\nno incluye regalos\nlínea 5\nlínea 6\n¿Lo querés?'
    assert.equal(shortenToMaxLines(long, 3), long)
    const plain = 'Hola 😊\nSomos tienda en línea\nTe cuento\nCon gusto\nMuy bueno\n¿Te ayudo?'
    assert.ok(shortenToMaxLines(plain, 2).split('\n').length < plain.split('\n').length)
  })
})

describe('SecureDog re-review 2026-10-15: INT-100..102, MEDIA-15', () => {
  it('INT-100: an info question that also claims a payment stays with a person', () => {
    for (const t of [
      '¿A qué número le hago el sinpe? Ya le envié 15 mil',
      '¿A qué número es el sinpe? ayer les envié 15 mil',
      '¿Con qué banco es el sinpe? Envié ₡15.000',
      '¿El pago es adelantado? porque ya le envié todo',
      '¿A qué número es el sinpe? Ya se los envié, ¿todo bien?',
    ]) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('INT-100: more "it is fine" replies are blocked in a payment conversation', () => {
    for (const reply of ['Sí, todo bien 😊', 'Sí, llegó bien', 'Sí señor, ya está', 'Sí, ya se hizo', 'No hay ningún problema con tu pago', 'Perfecto, ya está listo tu pago', 'Sí, todo salió bien']) {
      assert.ok(validateAgentOutput({ text: reply, citedToolNames: [], customerText: '¿A qué número es el sinpe?' }).reasons.includes('payment_status_claim'), reply)
    }
  })
  it('MEDIA-15: claims with an amount but no payment word; context-wide backstop; any store payment talk = waiting for a receipt', async () => {
    for (const t of ['Le envié 15 mil', 'Te mandé 20 mil', 'Envié ₡15.000 hace un rato']) assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    const { conversationPaymentContext } = await import('@/lib/soft-ai/llm/runtime')
    assert.equal(conversationPaymentContext([{ direction: 'inbound', content: '[image]' }], '¿Les llegó?'), true)
    assert.equal(conversationPaymentContext([{ direction: 'outbound', content: 'Hacé el SINPE a este mismo número 😊' }], '¿Ya lo vieron?'), true)
    assert.equal(conversationPaymentContext([{ direction: 'inbound', content: 'hola' }], '¿tienen talla M?'), false)
    assert.ok(validateAgentOutput({ text: 'Sí, ya lo vimos 😊', citedToolNames: [], customerText: '¿Ya lo vieron?', paymentContext: true }).reasons.includes('payment_status_claim'))
    const { mediaAwaitingReceipt } = await import('@/lib/soft-ai/sales-state')
    assert.equal(mediaAwaitingReceipt('image', [{ id: '1', direction: 'outbound', content: 'Hacé el SINPE a este mismo número 😊', sentAt: '' }], null), true)
    assert.equal(mediaAwaitingReceipt('image', [{ id: '1', direction: 'outbound', content: '¿Qué talla buscás?', sentAt: '' }], null), false)
  })
  it('INT-101: OFF cancels before stamping; INT-102: periodic sweep never re-answers flag_off / missing_mode', () => {
    const src = read('src/lib/soft-ai/agent-activation.ts')
    assert.ok(src.indexOf('await cancelLineTestRuns(input.tenantId, input.agentId, account.id)') < src.indexOf("code: 'OFF' }"))
    assert.equal(PERIODIC_REARM_SKIP_REASONS.has('flag_off'), false)
    assert.equal(PERIODIC_REARM_SKIP_REASONS.has('missing_mode'), false)
  })
})

describe('SecureDog INT-125: noun-first payment confirmations are blocked in a payment conversation', () => {
  it('blocks "tu pago está bien / entró / ya cayó / vimos tu pago" style replies', () => {
    for (const reply of [
      'Sí, tu pago está bien',
      'Listo, el pago quedó listo',
      'Sí, tu pago entró',
      'Tu sinpe ya cayó',
      'Perfecto, tu pago está correcto',
      'Ya vimos tu pago',
      'Ya revisamos tu pago y está bien',
      'Tu transferencia ya llegó 😊',
      'El comprobante fue recibido',
    ]) {
      assert.ok(validateAgentOutput({ text: reply, citedToolNames: [], customerText: 'ya pagué', paymentContext: true }).reasons.includes('payment_status_claim'), reply)
    }
  })
  it('does not block normal payment-flow replies', () => {
    for (const reply of [
      'Cuando hagás el SINPE, mandame el comprobante por aquí 😊',
      'Cuando tu pago entre, el equipo te confirma',
      'Podés pagar por SINPE Móvil o con tarjeta en la web',
      'El envío llega en 2 a 4 días hábiles',
    ]) {
      assert.ok(!validateAgentOutput({ text: reply, citedToolNames: [], customerText: '¿cómo pago?', paymentContext: true }).reasons.includes('payment_status_claim'), reply)
    }
  })
})

describe('2026-10-16 Sleeping quick check: "Pack" bundles with shipping included are a fact, not a promo', () => {
  it('accepts the owner\'s own bundle word and a bracketed name note; keeps INT-84..92 protections', async () => {
    const { salesFreeShippingRule } = await import('@/lib/soft-ai/sales-state')
    const sleeping = salesFreeShippingRule({
      bundles: [
        { name: 'Pack 2 bolsas (60 noches)', price: 19800, shippingIncluded: true },
        { name: 'Pack 3 bolsas (90 noches)', price: 28500, shippingIncluded: true },
      ],
      catalog: [{ name: 'SleepingPatches', price: 9900 }],
    } as never)
    assert.deepEqual(sleeping?.bundleWords, ['pack'])
    assert.deepEqual(sleeping?.otherNames, [])
    assert.deepEqual(sleeping?.nameNotes, ['60 noches', '90 noches'])
    for (const reply of [
      'Cada bolsa de SleepingPatches trae 30 parches y sale en ₡9 900 más el envío 🌙\nSi querés, el pack de 2 bolsas (60 noches) queda en ₡19 800 con el envío incluido.',
      'El Pack 2 bolsas (60 noches) sale en ₡19 800 con envío incluido 😊',
      'El pack de 3 bolsas de SleepingPatches cuesta ₡28 500 y ya incluye el envío.',
    ]) {
      const v = validateAgentOutput({ text: reply, citedToolNames: [], freeShippingRule: sleeping } as never)
      assert.ok(!v.reasons.includes('deal_offer'), reply)
    }
    for (const reply of [
      'El envío es gratis 😊',
      'Una bolsa sale en ₡9 900 con envío incluido',
      'Los packs de 2 y 3 bolsas traen envío incluido (₡19 800 y ₡28 500)',
      'El pack de 2 bolsas queda en ₡19 800 con envío incluido, y para vos también la bolsa sola',
      'El pack de 2 bolsas (envío gratis) sale en ₡9 900',
    ]) {
      const v = validateAgentOutput({ text: reply, citedToolNames: [], freeShippingRule: sleeping } as never)
      assert.ok(v.reasons.includes('deal_offer'), reply)
    }
    // PatchHouse (several products): naming another product next to "envío incluido" is still refused (INT-91).
    const ph = salesFreeShippingRule({
      bundles: [{ name: 'Combo Trío (3 paquetes a elección)', price: 26900, shippingIncluded: true }],
      catalog: [{ name: 'Focus Patch', price: 9900 }, { name: 'Energy Patch', price: 9900 }],
    } as never)
    assert.ok(validateAgentOutput({ text: 'El Focus va con el combo Trío a ₡26 900 con envío incluido', citedToolNames: [], freeShippingRule: ph } as never).reasons.includes('deal_offer'))
    assert.ok(!validateAgentOutput({ text: 'El Combo Trío (3 paquetes a elección) sale en ₡26 900 con envío incluido 🌿', citedToolNames: [], freeShippingRule: ph } as never).reasons.includes('deal_offer'))
  })
})

describe('SecureDog INT-126: nothing can hide inside brackets in a free-shipping reply', () => {
  it('only owner name notes are ignored; every other bracket is checked', async () => {
    const { salesFreeShippingRule } = await import('@/lib/soft-ai/sales-state')
    const sleeping = salesFreeShippingRule({
      bundles: [
        { name: 'Pack 2 bolsas (60 noches)', price: 19800, shippingIncluded: true },
        { name: 'Pack 3 bolsas (90 noches)', price: 28500, shippingIncluded: true },
      ],
      catalog: [{ name: 'SleepingPatches', price: 9900 }],
    } as never)
    const ph = salesFreeShippingRule({
      bundles: [
        { name: 'Combo 2 paquetes (a elección)', price: 17900, shippingIncluded: false },
        { name: 'Combo Trío (3 paquetes a elección)', price: 26900, shippingIncluded: true },
      ],
      catalog: [{ name: 'Focus Patch', price: 9900 }, { name: 'Energy Patch', price: 9900 }],
    } as never)
    const blocked: Array<[string, unknown]> = [
      ['El pack de 2 bolsas sale en ₡19 800 con envío incluido (y la bolsa sola también)', sleeping],
      ['El pack de 2 bolsas (o el pack de 3) sale en ₡19 800 con envío incluido', sleeping],
      ['Una bolsa con envío incluido (bueno) el pack sale en ₡19 800', sleeping],
      ['El Combo Trío sale en ₡26 900 con envío incluido (el Focus igual)', ph],
      ['El Combo Trío (y el Focus Patch también) sale en ₡26 900 con envío incluido', ph],
      ['El Combo Trío (o el Combo 2 paquetes) sale en ₡26 900 con envío incluido', ph],
      ['El Combo 2 paquetes (igual que el Trío) va con envío incluido, el Trío sale en ₡26 900', ph],
    ]
    for (const [text, rule] of blocked) {
      assert.ok(validateAgentOutput({ text, citedToolNames: [], freeShippingRule: rule } as never).reasons.includes('deal_offer'), text)
    }
    for (const [text, rule] of [
      ['El Pack 2 bolsas (60 noches) sale en ₡19 800 con envío incluido 😊', sleeping],
      ['El Combo Trío (3 paquetes a elección) sale en ₡26 900 con envío incluido 🌿', ph],
    ] as Array<[string, unknown]>) {
      assert.ok(!validateAgentOutput({ text, citedToolNames: [], freeShippingRule: rule } as never).reasons.includes('deal_offer'), text)
    }
  })
})
