import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractShortcutTag, selectReplyImages } from '@/lib/soft-ai/reply-images'
import {
  SALES_REPLY_TEMPLATES,
  guideShortcutCatalog,
  validateShortcutForSave,
  type RuntimeShortcut,
} from '@/lib/soft-ai/shortcuts'
import { importedReplyDraft, importedReplyKey } from '@/lib/soft-ai/agent-replies'
import type { AgentAsset } from '@/lib/soft-ai/agent-assets'

const asset = (id: string, sha = `sha-${id}`): AgentAsset => ({
  id,
  name: `${id}.jpg`,
  caption: null,
  mimeType: 'image/jpeg',
  sizeBytes: 10,
  width: 10,
  height: 10,
  sha256: sha,
  blobPath: `agent-assets/t1/${sha}.jpg`,
  agentId: 'a1',
  url: `/api/chat/agents/a1/assets/${id}`,
})

const reply = (over: Partial<RuntimeShortcut>): RuntimeShortcut => ({
  id: 's1',
  key: 'pb_tallas',
  title: 'Guía de tallas',
  kind: 'playbook',
  intents: [],
  keywords: ['talla'],
  body: 'Te paso la guía 👇',
  deliveryMode: 'verbatim',
  isActive: true,
  sortOrder: 1,
  ...over,
})

test('[[ATAJO:clave]] is stripped from the customer text and its key returned', () => {
  assert.deepEqual(extractShortcutTag('Te paso la guía 👇 [[ATAJO:pb_tallas]]'), { text: 'Te paso la guía 👇', key: 'pb_tallas' })
  // Near-misses never leak; first key wins.
  assert.deepEqual(extractShortcutTag('Hola [ atajo = pb_promo ] y [[ATAJO:pb_envio]]'), { text: 'Hola y', key: 'pb_promo' })
  assert.equal(extractShortcutTag('Hola [[ATAJO: algo raro!!]]').text, 'Hola')
  assert.deepEqual(extractShortcutTag('Sin etiqueta'), { text: 'Sin etiqueta', key: null })
})

test('images: only an active owner reply of this agent, ≤3, never twice in a chat', () => {
  const shortcuts = [reply({}), reply({ id: 's2', key: 'sys_payment_info', kind: 'payment_info' }), reply({ id: 's3', key: 'pb_off', isActive: false })]
  const assetsByShortcut = new Map([
    ['s1', [asset('i1'), asset('i2'), asset('i3'), asset('i4')]],
    ['s2', [asset('x')]],
    ['s3', [asset('y')]],
  ])
  assert.deepEqual(selectReplyImages({ shortcutKey: 'pb_tallas', shortcuts, assetsByShortcut }).images.map((i) => i.assetId), ['i1', 'i2', 'i3'])
  assert.deepEqual(
    selectReplyImages({ shortcutKey: 'pb_tallas', shortcuts, assetsByShortcut, alreadySent: ['i1', 'sha-i2'] }).images.map((i) => i.assetId),
    ['i3', 'i4'],
  )
  // System replies, switched-off replies and unknown / made-up keys never carry images.
  assert.equal(selectReplyImages({ shortcutKey: 'sys_payment_info', shortcuts, assetsByShortcut }).images.length, 0)
  assert.equal(selectReplyImages({ shortcutKey: 'pb_off', shortcuts, assetsByShortcut }).images.length, 0)
  assert.equal(selectReplyImages({ shortcutKey: 'pb_nada', shortcuts, assetsByShortcut }).images.length, 0)
  assert.equal(selectReplyImages({ shortcutKey: null, shortcuts, assetsByShortcut }).images.length, 0)
})

test('catalog lists owner keyword replies too, marks images and asks for the tag', () => {
  const catalog = guideShortcutCatalog([reply({}), reply({ id: 's9', key: 'pb_envio', deliveryMode: 'guide', title: 'Envío' })], new Set(['s1']))
  assert.match(catalog, /pb_tallas: Guía de tallas \(va con imagen\)/)
  assert.match(catalog, /pb_envio: Envío\. /)
  // The tag rule is code-owned (fixed rule 14), not inside the data block.
  assert.doesNotMatch(catalog, /ATAJO/)
  assert.ok(catalog.indexOf('pb_envio') < catalog.indexOf('pb_tallas'), 'guide rows first')
  assert.match(readFileSync('src/lib/soft-ai/llm/prompt.ts', 'utf8'), /'14\) Si usás una de las respuestas guardadas[^']*\[\[ATAJO:clave\]\]/)
  assert.equal(guideShortcutCatalog([reply({ isActive: false })]), '')
})

test('ready-made sales replies are valid, owner-editable and unique', () => {
  const keys = new Set<string>()
  for (const t of SALES_REPLY_TEMPLATES) {
    assert.deepEqual(validateShortcutForSave(t), { ok: true }, t.key)
    assert.ok(t.key.startsWith('pb_'))
    assert.ok(!keys.has(t.key))
    keys.add(t.key)
  }
  assert.ok(keys.has('pb_tallas') && keys.has('pb_promo'))
})

test('team quick replies import as agent replies (off, adapted, {nombre} kept)', () => {
  assert.equal(importedReplyKey('envio-gam'), 'eq_envio_gam')
  assert.equal(importedReplyKey('---'), '')
  const draft = importedReplyDraft({ shortcut: 'precio', text: 'Hola {nombre}, vale ₡14.900', hasImages: false }, 3)
  assert.equal(draft?.key, 'eq_precio')
  assert.equal(draft?.isActive, false)
  assert.equal(draft?.deliveryMode, 'guide')
  assert.match(draft?.body ?? '', /\{\{client\.firstName\}\}/)
  // Image-only replies get a short line; confirmation wording is refused.
  assert.equal(importedReplyDraft({ shortcut: 'tallas', text: '', hasImages: true }, 1)?.body, 'Te paso la info 👇')
  assert.equal(importedReplyDraft({ shortcut: 'ok', text: 'Pago confirmado ✅', hasImages: false }, 1), null)
  assert.equal(importedReplyDraft({ shortcut: 'vacio', text: '', hasImages: false }, 1), null)
})

test('routes: guard on every asset route, private cache, ≤3 per reply, library seeds off', () => {
  const root = 'src/app/api/chat/agents/[id]'
  const upload = readFileSync(`${root}/assets/upload/route.ts`, 'utf8')
  assert.match(upload, /studioGuard\(request, id, 'heavy'\)/)
  assert.match(upload, /MAX_ASSET_INPUT_BYTES/)
  const one = readFileSync(`${root}/assets/[assetId]/route.ts`, 'utf8')
  assert.match(one, /studioGuard\(request, id, 'read'\)/)
  assert.match(one, /studioGuard\(request, id, 'write'\)/)
  assert.match(one, /'Cache-Control': 'private/)
  assert.match(one, /nosniff/)
  const set = readFileSync(`${root}/shortcuts/[shortcutId]/assets/route.ts`, 'utf8')
  assert.match(set, /studioGuard\(request, id, 'write'\)/)
  assert.match(set, /slice\(0, 3\)/)
  const lib = readFileSync(`${root}/shortcuts/library/route.ts`, 'utf8')
  assert.match(lib, /studioGuard\(request, id, 'heavy'\)/)
  const replies = readFileSync('src/lib/soft-ai/agent-replies.ts', 'utf8')
  assert.match(replies, /isActive: false/)
  assert.match(replies, /isQuickReplyMediaPath\(m\.path, actor\.tenantId\)/)
})

test('runtime strips the tag before validation; test chat gets images, not on hand-off', () => {
  const runtime = readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8')
  const tagAt = runtime.indexOf('extractShortcutTag(structured.text)')
  assert.ok(tagAt > 0 && tagAt < runtime.indexOf('validateAgentOutput({', tagAt))
  const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
  assert.match(turn, /text && !escalate && !notBound && !needsHuman && !fallbackUsed && \(account\.platform \|\| 'whatsapp'\) === 'whatsapp'\s*\?\s*selectReplyImages/)
  assert.match(turn, /alreadySent: input\.sentImageIds/)
})

test('live WhatsApp images: before the text, exactly-once keys, never twice per chat, never on hand-off', () => {
  const send = readFileSync('src/lib/soft-ai/agent-media-send.ts', 'utf8')
  assert.match(send, /deliveryKey: `\$\{ctx\.job\.deliveryKey\}:img:\$\{asset\.sha256\.slice\(0, 32\)\}`/)
  assert.match(send, /if \(Date\.now\(\) >= ctx\.deadlineAt\) break/)
  assert.match(send, /kind: 'image'/)
  // Upload (no customer effect) happens before the delivery row is claimed; failures never throw to the text send.
  assert.ok(send.indexOf('uploadToWhatsApp(ctx.phoneNumberId') < send.indexOf('await deliverOnce({'))
  assert.match(send, /agentAssetSha: asset\.sha256/)
  assert.match(send, /if \(delivery\.skipped\) continue/)
  const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
  const imagesAt = turn.indexOf('await sendAgentImagesOnce(')
  const textAt = turn.indexOf('const delivery = await deliverOnce({')
  assert.ok(imagesAt > 0 && imagesAt < textAt)
  assert.match(turn, /!textAlreadyClaimed && platform === 'whatsapp' && account\.accountId && input\.outputText && !input\.escalate/)
  assert.match(turn, /if \(!input\.outputText\.trim\(\)\) \{\s*return persistDecidedTurn\(\{[\s\S]{0,80}reason: 'empty_output'/)
  assert.match(turn, /alreadySent: await loadSentAgentImageShas\(input\.row\.tenantId, input\.row\.conversationId\)/)
  assert.match(turn, /replyShortcutKey: decision\.shortcutKey,/)
  assert.match(turn, /replyShortcutKey: policy\.purchaseSummaryAppended \? null : llm\.shortcutKey \|\| null/)
})

test('Verifier 2026-10-09: tag-only / template replies never become an empty or raw send', async () => {
  const { applyFinalOutputPolicy } = await import('@/lib/soft-ai/llm/output-validator')
  const facts = { schemaVersion: 1 } as never
  const empty = applyFinalOutputPolicy({ text: '[[ATAJO:pb_tallas]]', intent: 'other', citedToolNames: [], brandFacts: facts, shortcuts: [] } as never)
  assert.equal(empty.text, '')
  assert.equal(empty.needsHuman, true)
  assert.ok(empty.reasons.includes('empty_output'))
  const tpl = applyFinalOutputPolicy({ text: 'Pagás con {{brand.payment.summary}} 😊', intent: 'other', citedToolNames: [], brandFacts: facts, shortcuts: [] } as never)
  assert.doesNotMatch(tpl.text, /\{\{/)
  assert.equal(tpl.needsHuman, true)
  const runtime = readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8')
  const guardAt = runtime.indexOf("if (finalText && !extractShortcutTag(parseStructuredAgentOutput(finalText).text).text) finalText = ''")
  assert.ok(guardAt > 0 && guardAt < runtime.indexOf('const fb = await runAgentFallback'))
  assert.match(runtime, /key: repaired\.key \}/)
})

test('only replies whose image would really go out are marked "(va con imagen)"', async () => {
  const { sendableImageReplyIds } = await import('@/lib/soft-ai/reply-images')
  const map = new Map([['s1', [asset('i1')]], ['s2', [asset('i2'), asset('i3')]]])
  assert.deepEqual([...sendableImageReplyIds(map, ['i1', 'sha-i2'])], ['s2'])
  assert.deepEqual([...sendableImageReplyIds(map, ['i1', 'i2', 'i3'])], [])
  const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
  assert.match(turn, /replyImageShortcutIds: liveImageReplyIds/)
  assert.doesNotMatch(turn, /replyImageShortcutIds: new Set\(replyAssets\.keys\(\)\)/)
})

test('SecureDog 2026-10-09: near-miss tags never leak (INT-80)', () => {
  for (const t of ['Te paso la guía ATAJO:pb_tallas', 'Te paso la guía 【ATAJO:pb_tallas】', 'Te paso la guía ［［ATAJO:pb_tallas］］', 'Te paso la guía {{ATAJO:pb_tallas}}', 'Te paso la guía (ATAJO: pb_tallas)']) {
    const out = extractShortcutTag(t)
    assert.doesNotMatch(out.text, /ATAJO/i, t)
    assert.equal(out.key, 'pb_tallas', t)
  }
  assert.equal(extractShortcutTag('Atajos de teclado').text, 'Atajos de teclado')
})

test('SecureDog 2026-10-09: image decode bounded (MEDIA-11), versions bumped (INT-79), audited (MEDIA-12)', async () => {
  const { normalizeImage, AgentAssetError } = await import('@/lib/soft-ai/agent-assets')
  // TIFF / SVG bytes never reach a decoder.
  for (const bytes of [Buffer.from('49492a00080000000000000000000000', 'hex'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')]) {
    await assert.rejects(normalizeImage(bytes), (e: unknown) => e instanceof AgentAssetError && e.code === 'not_image')
  }
  const assets = readFileSync('src/lib/soft-ai/agent-assets.ts', 'utf8')
  assert.match(assets, /withImageDecodeSlot\(/)
  assert.match(assets, /\.timeout\(\{ seconds: 5 \}\)/)
  assert.match(assets, /failOn: 'error'/)
  assert.equal((assets.match(/version: \{ increment: 1 \}/g) || []).length, 2)
  const replies = readFileSync('src/lib/soft-ai/agent-replies.ts', 'utf8')
  assert.match(replies, /IMPORT_MAX_PHOTOS = 30/)
  assert.match(replies, /byPath\.has\(photo\.path\)/)
  assert.match(replies, /have\.size >= MAX_REPLIES_PER_AGENT/)
  const root = 'src/app/api/chat/agents/[id]'
  assert.match(readFileSync(`${root}/assets/upload/route.ts`, 'utf8'), /entityType: 'ChatAgentAsset'/)
  assert.match(readFileSync(`${root}/assets/[assetId]/route.ts`, 'utf8'), /safeMediaServeHeaders\(asset\.mimeType, asset\.name\)/)
  assert.match(readFileSync(`${root}/assets/route.ts`, 'utf8'), /assets\.map\(publicAgentAsset\)/)
  assert.match(readFileSync(`${root}/shortcuts/library/route.ts`, 'utf8'), /logAuditEvent\(/)
})

test('Verifier r2: keyword reply with an image that cannot go out → model answers; catalog has no customer name', async () => {
  const { decideInbound } = await import('@/lib/soft-ai/inbound-decision')
  const facts = { schemaVersion: 1 } as never
  const shortcuts = [reply({})]
  assert.equal(decideInbound({ inboundText: '¿qué talla me queda?', brandFacts: facts, shortcuts }).shortcutKey, 'pb_tallas')
  const skipped = decideInbound({ inboundText: '¿qué talla me queda?', brandFacts: facts, shortcuts, skipVerbatimIds: new Set(['s1']) })
  assert.equal(skipped.handled, false)
  const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
  assert.equal((turn.match(/skipVerbatimIds: new Set\(\[\.\.\.replyAssets\.keys\(\)\]/g) || []).length, 2)
  const inputs = readFileSync('src/lib/soft-ai/agent-turn-inputs.ts', 'utf8')
  assert.match(inputs, /facts: promptFacts,\s*clientFirstName: null,/)
  const { AI_NO_REPLY_REASONS } = await import('@/lib/workspace-notifications')
  assert.ok(AI_NO_REPLY_REASONS.empty_output)
})

test('Verifier r3: ordinary text is never altered by tag cleanup; images only on owner replies', () => {
  for (const t of ['Hay un atajo (atajo por la 27) para retirar', 'Es el 1º de la lista, mide 2 m² ™']) {
    assert.deepEqual(extractShortcutTag(t), { text: t, key: null })
  }
  assert.deepEqual(extractShortcutTag('Te paso la guía ＡＴＡＪＯ：pb_tallas'), { text: 'Te paso la guía', key: 'pb_tallas' })
  assert.match(readFileSync('src/lib/soft-ai/agent-assets.ts', 'utf8'), /shortcut\.kind !== 'playbook' \|\| shortcut\.key\.startsWith\('sys_'\)/)
})

test('SecureDog r3 (INT-80 leftover): tag-only brackets stripped whole; bare tag upper-case only', () => {
  for (const [t, k] of [['Listo [[ATAJO pb_tallas]]', 'pb_tallas'], ['Listo [[ATAJO]]', null], ['Listo [[ATAJO-pb_tallas]]', 'pb_tallas'], ['Listo **ATAJO:** pb_tallas', 'pb_tallas']] as const) {
    const out = extractShortcutTag(t)
    assert.equal(out.text, 'Listo', t)
    assert.equal(out.key, k, t)
  }
  const plain = 'Un atajo: escribinos "talla" y te paso la guía.'
  assert.equal(extractShortcutTag(plain).text, plain)
  assert.match(readFileSync('src/lib/soft-ai/llm/output-validator.ts', 'utf8'), /if \(\/ATAJO\/\.test\(text\)\) reasons\.push\('tag_leak'\)/)
})
