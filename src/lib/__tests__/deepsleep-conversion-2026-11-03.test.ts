/**
 * DeepSleep conversion fixes (2026-11-03 weekly review): payment false positives, pt_verlo deal_offer,
 * audio → type-it, follow-up stage slots, shortcut keyword matching.
 *
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/deepsleep-conversion-2026-11-03.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, isAckMethodChoice, isSalesPayQuestion } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS, matchVerbatimShortcut } from '@/lib/soft-ai/shortcuts'
import { mediaInboundPlan } from '@/lib/soft-ai/llm/safety-router'
import { followUpSlot, followUpStateSkip } from '@/lib/soft-ai/follow-up-state'
import { applyFinalOutputPolicy } from '@/lib/soft-ai/llm/output-validator'
import {
  DEEPSLEEP_AGENTS,
  FORGE_COLOR_LINE,
  FORGE_SHIPPING_LINE,
  FORGE_WASH_LINE,
  PURA_STAGE,
  STAGE_TEXTS,
  planFollowUpCampaignsOnEnable,
} from '@/lib/soft-ai/deepsleep-conversion-pack'

const FACTS = parseBrandFacts({
  payment: { shareWithCustomers: true, methods: ['sinpe', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' } },
})
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))

const PT_BODY =
  'Así vuela. El kit sale ₡14 900; con el envío son ₡17 900. Dos kits: ₡29 800 con envío incluido. Pagás por SINPE, transferencia, tarjeta en prototipocr.com, o contra entrega en el GAM. Cualquier otra duda estamos para servirte. ¿Te lo enviamos?'

describe('pt_verlo: owner verbatim with envío incluido is not deal_offer when deal context is passed', () => {
  const sc = [
    ...SHORTCUTS,
    {
      key: 'pt_verlo',
      title: 'Verlo',
      kind: 'playbook' as const,
      intents: ['other' as const],
      keywords: ['verlo', 'video', 'cómo funciona', 'tutorial'],
      deliveryMode: 'verbatim' as const,
      body: PT_BODY,
      isActive: true,
      sortOrder: 0,
    },
  ]

  it('without includedShippingAmounts the validator still holds (no blanket exemption)', () => {
    const d = decideInbound({ inboundText: 'quiero verlo', brandFacts: FACTS, shortcuts: sc, allowedAmounts: [14900, 17900, 29800, 3000] })
    assert.equal(d.shortcutKey, 'pt_verlo')
    assert.equal(d.needsHuman, true)
    assert.ok(d.reasons.includes('deal_offer'))
  })

  it('with includedShippingAmounts the owner reply goes out (same as the model path)', () => {
    const d = decideInbound({
      inboundText: 'quiero verlo',
      brandFacts: FACTS,
      shortcuts: sc,
      allowedAmounts: [14900, 17900, 29800, 3000],
      includedShippingAmounts: [29800],
    })
    assert.equal(d.shortcutKey, 'pt_verlo')
    assert.equal(d.needsHuman, false)
    assert.equal(d.textOk, true)
    assert.ok(!d.reasons.includes('deal_offer'))
  })

  it('applyFinalOutputPolicy alone: included amount masks envío incluido', () => {
    const bare = applyFinalOutputPolicy({
      text: PT_BODY,
      intent: 'other',
      citedToolNames: [],
      brandFacts: FACTS,
      shortcuts: [],
      quoteAmounts: [14900, 17900, 29800, 3000],
    })
    assert.ok(bare.reasons.includes('deal_offer'))
    const ok = applyFinalOutputPolicy({
      text: PT_BODY,
      intent: 'other',
      citedToolNames: [],
      brandFacts: FACTS,
      shortcuts: [],
      quoteAmounts: [14900, 17900, 29800, 3000],
      includedShippingAmounts: [29800],
    })
    assert.ok(!ok.reasons.includes('deal_offer'))
  })

  it('widened pt_verlo keywords match (cómo funciona, video, tutorial, typos)', () => {
    const row = sc.find((s) => s.key === 'pt_verlo')!
    for (const t of ['cómo funciona', 'quiero verlo', 'me pasás un video', 'hay tutorial']) {
      assert.equal(matchVerbatimShortcut(t, [row])?.key, 'pt_verlo', t)
    }
  })
})

describe('payment: live false positives stay with the agent; real claims still hand off', () => {
  const safe = [
    'oki sinpe',
    'perfecto voy a confirmar mi peso y les aviso',
    'preferiría pagarlo de una vez con sinpe, ¿a qué número sería, y le paso el comprobante por acá?',
    'bueno y se te hace el pago en el sitio?',
    'muchas gracias solo estoy esperando un pago para poder realizar la compra',
    'entonces en ese precio por dos ya viene pago el envío de correos? muchas gracias',
    'es solo con envío? no las puedo pasar a retirar a alguna parte y ahí pagar?',
    'hay manera de que en algún momento pueda retirarlo de manera personal y pagar ahi mismo',
    'me interesan si apenas pueda hacer el pago los contacto',
    '¿cuál es el proceso de pago?',
    'el envio cuanto dura',
    'ya te escribo',
    'de cuando sería el monto?',
  ]
  const claims = [
    'Ya pagué',
    'Listo el pago',
    'te mando el comprobante',
    'Ya pagué el envío',
    'Listo, ya le hice el SINPE',
    'Hola cómo está, efectué la transferencia de 25.000',
  ]

  it('replay of anonymized safe phrasings is never payment_proof_or_risk', () => {
    for (const t of safe) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('real receipt / ya pagué / SINPE proof still hand off', () => {
    for (const t of claims) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('helpers pin the new shapes', () => {
    assert.equal(isAckMethodChoice('oki sinpe'), true)
    assert.equal(isAckMethodChoice('Ya pagué'), false)
    assert.equal(isSalesPayQuestion('viene pago el envío?'), true)
    assert.equal(isSalesPayQuestion('Ya pagué'), false)
  })

  it('decideInbound does not escalate on the safe replay set', () => {
    for (const t of safe) {
      const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.equal(d.escalate, false, t)
    }
  })
})

describe('audio without a receipt asks them to type it', () => {
  it('audio / voice is never a receipt, even while awaitingReceipt', () => {
    assert.equal(mediaInboundPlan({ messageType: 'audio', awaitingReceipt: true }), 'ask_in_writing')
    assert.equal(mediaInboundPlan({ messageType: 'voice', awaitingReceipt: true }), 'ask_in_writing')
    assert.equal(mediaInboundPlan({ messageType: 'image', awaitingReceipt: true }), 'receipt')
    assert.equal(mediaInboundPlan({ messageType: 'document', awaitingReceipt: true }), 'receipt')
  })

  it('decideInbound sends sys_media_ask for an audio, not the payment hand-off line', () => {
    const d = decideInbound({
      inboundText: '[audio]',
      messageType: 'audio',
      brandFacts: FACTS,
      shortcuts: SHORTCUTS,
      awaitingReceipt: true,
    })
    assert.equal(d.shortcutKey, 'sys_media_ask')
    assert.equal(d.escalate, false)
    assert.match(d.text || '', /por escrito/i)
  })
})

describe('follow-up stage selection references the last stage', () => {
  const out = (content: string) => ({ direction: 'outbound', content })
  const inb = (content: string) => ({ direction: 'inbound', content })

  it('price → quoted; size talk → size; how it works → how_it_works; data ask → shipping_details', () => {
    assert.equal(followUpSlot([inb('¿Cuánto cuesta?'), out('₡14 900 con envío. ¿Te lo aparto?')], false), 'quoted')
    assert.equal(
      followUpSlot(
        [inb('¿Cuánto cuesta?'), out('₡14 900'), inb('peso 72 kg'), out('Te queda XL. El peso es el que manda. ¿Te lo aparto?')],
        false,
      ),
      'size',
    )
    assert.equal(followUpSlot([inb('cómo funciona'), out('Se coloca como un chaleco… ¿Querés verlo?')], false), 'how_it_works')
    assert.equal(
      followUpSlot([inb('lo quiero'), out('¡Perfecto! Para preparar tu pedido me pasás:\n- Nombre completo\n- Teléfono')], false),
      'shipping_details',
    )
  })

  it('a later-date bubble still skips via followUpStateSkip (existing)', () => {
    assert.equal(followUpStateSkip([inb('Mañana les escribo')]), 'waiting_date')
  })
})

describe('fg_tallas keyword matching includes kg / kilos / peso / mido', () => {
  it('whole-word match picks fg_tallas on weight words', () => {
    const row = {
      key: 'fg_tallas',
      title: 'Tallas',
      kind: 'playbook' as const,
      intents: ['other' as const],
      keywords: ['talla', 'kg', 'kilos', 'peso', 'mido'],
      deliveryMode: 'verbatim' as const,
      body: 'El peso manda…',
      isActive: true,
      sortOrder: 0,
    }
    for (const t of ['peso 80 kg', 'mido 1.70', 'son 70 kilos', 'qué talla']) {
      assert.equal(matchVerbatimShortcut(t, [row])?.key, 'fg_tallas', t)
    }
  })
})

describe('follow-up enable: only intended DeepSleep agents; PatchHouse untouched', () => {
  it('planFollowUpCampaignsOnEnable activates Forge/Sleeping/Pura/Prototipo and keeps PatchHouse', () => {
    const before = [
      { id: 'c-forge', agentId: DEEPSLEEP_AGENTS.forge, active: false, texts: { A: 'x', B: 'y' } },
      { id: 'c-sleep', agentId: DEEPSLEEP_AGENTS.sleeping, active: false, texts: { A: 'x', B: 'y' } },
      { id: 'c-pura', agentId: DEEPSLEEP_AGENTS.pura, active: false, texts: { A: 'x', B: 'y' } },
      { id: 'c-proto', agentId: DEEPSLEEP_AGENTS.prototipo, active: true, texts: { A: 'x', B: 'y' } },
      { id: 'c-patch', agentId: DEEPSLEEP_AGENTS.patchhouse, active: false, texts: { A: 'old', B: 'old' }, stageTexts: { A: { quoted: 'keep-me' } } },
    ]
    const next = planFollowUpCampaignsOnEnable(before)
    assert.equal(next.find((c) => c.id === 'c-forge')!.active, true)
    assert.equal(next.find((c) => c.id === 'c-sleep')!.active, true)
    assert.equal(next.find((c) => c.id === 'c-pura')!.active, true)
    assert.equal(next.find((c) => c.id === 'c-proto')!.active, true)
    const patch = next.find((c) => c.id === 'c-patch')!
    assert.equal(patch.active, false, 'PatchHouse must stay inactive')
    assert.deepEqual(patch.stageTexts, { A: { quoted: 'keep-me' } })
    assert.equal(next.find((c) => c.id === 'c-pura')!.stageTexts, PURA_STAGE)
    assert.equal(next.find((c) => c.id === 'c-sleep')!.stageTexts, STAGE_TEXTS)
    assert.equal(next.find((c) => c.id === 'c-proto')!.stageTexts, STAGE_TEXTS)
  })

  it('generic STAGE_TEXTS never mention Arnés or slash product menus (Sleeping/Prototipo safe)', () => {
    const blob = JSON.stringify(STAGE_TEXTS)
    assert.equal(/arn[eé]s/i.test(blob), false)
    assert.equal(blob.includes(' / '), false)
    assert.equal(STAGE_TEXTS.A.quoted, '¡Hola! 😊 ¿Querés que te lo aparte?')
    assert.equal(STAGE_TEXTS.B.quoted, '¡Hola! ¿Todavía te interesa? Te lo puedo apartar hoy mismo 🚚')
    assert.equal(PURA_STAGE.B.quoted, '¡Hola! ¿Te armo el Combo 2 cajas a ₡19 900 ya con envío? 😊')
  })

  it('owner-confirmed Forge facts: black only, nationwide shipping, wash line, no smell claim', () => {
    assert.equal(FORGE_COLOR_LINE, 'Por ahora viene solo en negro 🖤')
    assert.equal(FORGE_SHIPPING_LINE, '2 a 3 días hábiles')
    assert.match(FORGE_WASH_LINE, /mano con agua fría/)
    assert.match(FORGE_WASH_LINE, /no al sol directo/)
    assert.match(FORGE_WASH_LINE, /No lo metás en lavadora ni secadora/)
    assert.equal(/olor|huele|olfato/i.test(FORGE_WASH_LINE), false)
    assert.equal(/según zona/i.test(FORGE_SHIPPING_LINE), false)
  })
})
