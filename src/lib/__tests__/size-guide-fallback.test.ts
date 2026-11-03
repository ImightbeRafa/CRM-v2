/**
 * Size-guide image fallback (DeepSleep review 2026-11-03): a price / size question (or a reply that promises the guide) gets the brand's guide image once
 * per chat; never for an agent without a configured guide; flag off = unchanged. The hand-off rule stays in the caller
 * (the live image block and Probar both skip images on a hand-off) — checked on the source below.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SIZE_GUIDE_FLAG, isPriceOrSizeQuestion, promisesSizeGuide, sizeGuideFallbackKey, sizeGuideKeyFor } from '@/lib/soft-ai/size-guide'
import type { RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import type { AgentAsset } from '@/lib/soft-ai/agent-assets'

const FORGE = 'cmub1rziw0005l704mebpx4xc'
const asset = (id: string, mimeType: AgentAsset['mimeType'] = 'image/jpeg'): AgentAsset => ({
  id, name: `${id}.jpg`, caption: null, mimeType, sizeBytes: 10, width: 10, height: 10, sha256: `sha-${id}`,
  blobPath: `agent-assets/t1/${id}`, agentId: FORGE, url: `/api/chat/agents/x/assets/${id}`,
})
const sc = (id: string, key: string, over: Partial<RuntimeShortcut> = {}): RuntimeShortcut => ({
  id, key, title: key, kind: 'playbook', intents: [], keywords: [], body: 'x', deliveryMode: 'guide', isActive: true, sortOrder: 1, ...over,
})
const shortcuts = [sc('s-tallas', 'fg_tallas'), sc('s-precio', 'fg_precio'), sc('s-pers', 'fg_personalizar', { deliveryMode: 'verbatim' }), sc('s-video', 'pt_verlo')]
const assetsByShortcut = new Map<string, AgentAsset[]>([
  ['s-tallas', [asset('guia-tallas-forge')]],
  ['s-video', [asset('vuelo', 'video/mp4')]],
])
const base = { guideKey: 'fg_tallas', shortcuts, assetsByShortcut }

describe('size-guide fallback', () => {
  it('flag key is stable', () => assert.equal(SIZE_GUIDE_FLAG, 'agent_size_guide_v1'))

  it('price and size questions are recognised; others are not', () => {
    for (const t of ['¿Cuánto cuesta el soporte de ForgeCR?', '¿Precio?', 'cuanto vale', '¿Qué talla soy?', 'Mido 1.80 y peso 90kg', 'peso 72 kilos', '¿me queda?', 'medidas?'])
      assert.equal(isPriceOrSizeQuestion(t), true, t)
    for (const t of ['¿Puedo personalizarlo según mis necesidades?', '¿Es adecuado para personas con dolores de espalda crónicos?', 'Hola quiero comprar uno', '¿Hacen envíos?', 'gracias', ''])
      assert.equal(isPriceOrSizeQuestion(t), false, t)
  })

  it('price question with a model reply that used fg_precio (no image) → the guide', () => {
    assert.equal(sizeGuideFallbackKey({ ...base, customerText: '¿Cuánto cuesta?', replyShortcutKey: 'fg_precio' }), 'fg_tallas')
    assert.equal(sizeGuideFallbackKey({ ...base, customerText: '¿Cuánto cuesta?', replyShortcutKey: null }), 'fg_tallas')
  })

  it('burst (IG ad: price + personalizar) with the verbatim fg_personalizar → the guide', () => {
    const text = '[ig_post]\n¿Cuánto cuesta el soporte de ForgeCR?\n¿Puedo personalizarlo según mis necesidades?'
    assert.equal(sizeGuideFallbackKey({ ...base, customerText: text, replyShortcutKey: 'fg_personalizar' }), 'fg_tallas')
  })

  it('IG ad (no price / size words) where the reply promises the guide (fg_personalizar) → the guide', () => {
    const personalizar = '¡Sí! 💪 Las tiras son de tensión ajustable… Viene en tallas de M/L a 4XL; te paso la guía para que elijas la tuya.'
    assert.equal(promisesSizeGuide(personalizar), true)
    assert.equal(promisesSizeGuide('Te dejo la guía de tallas 👇'), true)
    assert.equal(promisesSizeGuide('El arnés ayuda a la postura 💙'), false)
    assert.equal(promisesSizeGuide('Te guío con el pedido'), false)
    const customerText = '[ig_post]\n¿Puedo personalizarlo según mis necesidades?'
    assert.equal(sizeGuideFallbackKey({ ...base, customerText, replyText: personalizar, replyShortcutKey: 'fg_personalizar' }), 'fg_tallas')
    assert.equal(sizeGuideFallbackKey({ ...base, customerText, replyText: 'Sí, las tiras se ajustan 😊', replyShortcutKey: null }), null)
  })

  it('once per chat: already sent (by id or sha) → nothing', () => {
    assert.equal(sizeGuideFallbackKey({ ...base, customerText: 'precio?', replyShortcutKey: null, alreadySent: ['guia-tallas-forge'] }), null)
    assert.equal(sizeGuideFallbackKey({ ...base, customerText: 'precio?', replyShortcutKey: null, alreadySent: ['sha-guia-tallas-forge'] }), null)
  })

  it('the reply already sends its own image (fg_tallas itself) → no extra', () => {
    assert.equal(sizeGuideFallbackKey({ ...base, customerText: '¿qué talla?', replyShortcutKey: 'fg_tallas' }), null)
  })

  it('not a price / size question → nothing', () => {
    assert.equal(sizeGuideFallbackKey({ ...base, customerText: '¿Es adecuado para dolor de espalda?', replyShortcutKey: null }), null)
  })

  it('no guide configured, guide key missing, inactive, or without an image → nothing (brands without a guide)', () => {
    assert.equal(sizeGuideFallbackKey({ ...base, guideKey: null, customerText: 'precio?', replyShortcutKey: null }), null)
    assert.equal(sizeGuideFallbackKey({ ...base, guideKey: 'ps_tallas', customerText: 'precio?', replyShortcutKey: null }), null)
    assert.equal(sizeGuideFallbackKey({ ...base, guideKey: 'fg_precio', customerText: 'precio?', replyShortcutKey: null }), null)
    assert.equal(sizeGuideFallbackKey({ ...base, guideKey: 'pt_verlo', customerText: 'precio?', replyShortcutKey: null }), null, 'a clip is not a guide image')
    const inactive = [sc('s-tallas', 'fg_tallas', { isActive: false })]
    assert.equal(sizeGuideFallbackKey({ ...base, shortcuts: inactive, customerText: 'precio?', replyShortcutKey: null }), null)
  })

  it('config: off / other agent / bad shape → null; on + agent → key', () => {
    const cfg = { agents: { [FORGE]: 'fg_tallas' } }
    assert.equal(sizeGuideKeyFor(null, FORGE), null)
    assert.equal(sizeGuideKeyFor({ enabled: false, config: cfg }, FORGE), null)
    assert.equal(sizeGuideKeyFor({ enabled: true, config: cfg }, 'cmvda4onv0001vip0rj6q7jkt'), null)
    assert.equal(sizeGuideKeyFor({ enabled: true, config: { agents: [] } }, FORGE), null)
    assert.equal(sizeGuideKeyFor({ enabled: true, config: { agents: { [FORGE]: 'Bad Key!' } } }, FORGE), null)
    assert.equal(sizeGuideKeyFor({ enabled: true, config: {} }, FORGE), null)
    assert.equal(sizeGuideKeyFor({ enabled: true, config: cfg }, FORGE), 'fg_tallas')
  })
})

describe('size-guide wiring (agent-turn.ts)', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
  it('live: the fallback sits inside the image block that skips escalations / hand-offs, and never on needsHuman', () => {
    const block = src.slice(src.indexOf('// Images of the saved reply first'), src.indexOf('// agents2-format: the reply goes out as up to 3 messages'))
    assert.match(block, /!input\.escalate && !input\.handoff/)
    assert.match(block, /!ownPick\.images\.length && input\.sizeGuide && !input\.needsHuman/)
  })
  it('both live call sites pass the size guide; Probar uses the same fallback, never on a hand-off', () => {
    assert.equal((src.match(/sizeGuide: sizeGuideKey \?/g) || []).length, 2)
    assert.match(src, /!needsHuman && !fallbackUsed && !handoff && imageChannel\(account\.platform\)\s*\n\s*\? sizeGuideFallbackKey\(/)
    assert.match(src, /selectReplyImages\(\{ shortcutKey: probarGuideKey \?\? shortcutKey,/)
    assert.match(src, /replyText: input\.outputText,/)
    assert.match(src, /replyText: text,/)
  })
})
