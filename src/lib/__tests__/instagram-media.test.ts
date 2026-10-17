import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  INSTAGRAM_IMAGE_MAX_BYTES,
  INSTAGRAM_MEDIA_ONLY_PHOTOS,
  instagramPath,
  sendInstagramImage,
  uploadInstagramImage,
} from '../instagram-media'
import { IG_OUTBOUND_ACCEPT } from '../chat-outbound-media'

type Call = { url: string; init: RequestInit }
const realFetch = globalThis.fetch
let calls: Call[] = []
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  calls = []
  let i = 0
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses[Math.min(i++, responses.length - 1)]
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as typeof fetch
}
afterEach(() => {
  globalThis.fetch = realFetch
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

describe('instagram photos · upload', () => {
  it('uploads the bytes to the Page message_attachments with platform=instagram (no public link)', async () => {
    mockFetch([{ status: 200, body: { attachment_id: '987' } }])
    const r = await uploadInstagramImage({ pageId: '1007', accessToken: 'tok', bytes: PNG, mime: 'image/png', timeoutMs: 1000 })
    assert.deepEqual(r, { ok: true, attachmentId: '987' })
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/1007\/message_attachments/)
    const form = calls[0].init.body as FormData
    assert.equal(form.get('platform'), 'instagram')
    assert.deepEqual(JSON.parse(String(form.get('message'))), { attachment: { type: 'image', payload: { is_reusable: true } } })
    assert.ok(form.get('filedata') instanceof Blob)
    assert.doesNotMatch(String(form.get('message')), /url/)
  })

  it('refuses non-photos and > 8 MB without calling Meta', async () => {
    mockFetch([{ status: 200, body: { attachment_id: 'x' } }])
    const pdf = await uploadInstagramImage({ pageId: '1', accessToken: 't', bytes: PNG, mime: 'application/pdf', timeoutMs: 1000 })
    const big = await uploadInstagramImage({ pageId: '1', accessToken: 't', bytes: new Uint8Array(INSTAGRAM_IMAGE_MAX_BYTES + 1), mime: 'image/jpeg', timeoutMs: 1000 })
    assert.deepEqual(pdf, { ok: false, error: INSTAGRAM_MEDIA_ONLY_PHOTOS })
    assert.deepEqual(big, { ok: false, error: INSTAGRAM_MEDIA_ONLY_PHOTOS })
    assert.equal(calls.length, 0)
  })

  it('a Meta error is returned, never thrown', async () => {
    mockFetch([{ status: 400, body: { error: { message: 'bad' } } }])
    const r = await uploadInstagramImage({ pageId: '1', accessToken: 't', bytes: PNG, mime: 'image/png', timeoutMs: 1000 })
    assert.equal(r.ok, false)
  })

  it('path falls back to me/ only without a page id', () => {
    assert.equal(instagramPath('12', 'messages'), '12/messages')
    assert.equal(instagramPath(null, 'message_attachments'), 'me/message_attachments')
  })
})

describe('instagram photos · send', () => {
  it('sends the attachment_id as an image reply inside the window', async () => {
    mockFetch([{ status: 200, body: { message_id: 'm1' } }])
    const r = await sendInstagramImage({ pageId: '1007', accessToken: 'tok', recipient: 'igsid', attachmentId: '987', timeoutMs: 1000 })
    assert.deepEqual(r.ok && r.providerMessageId, 'm1')
    const body = JSON.parse(String(calls[0].init.body))
    assert.deepEqual(body, { messaging_type: 'RESPONSE', recipient: { id: 'igsid' }, message: { attachment: { type: 'image', payload: { attachment_id: '987' } } } })
  })

  it('a clean 4xx rejection retries once as MEDIA_SHARE', async () => {
    mockFetch([{ status: 400, body: { error: { message: 'type' } } }, { status: 200, body: { message_id: 'm2' } }])
    const r = await sendInstagramImage({ pageId: '1', accessToken: 't', recipient: 'p', attachmentId: '9', timeoutMs: 1000 })
    assert.equal(r.ok, true)
    assert.equal(calls.length, 2)
    assert.equal(JSON.parse(String(calls[1].init.body)).message.attachment.type, 'MEDIA_SHARE')
  })

  it('a 5xx (may have gone out) is never retried — no double send', async () => {
    mockFetch([{ status: 500, body: { error: { message: 'down' } } }, { status: 200, body: { message_id: 'm3' } }])
    const r = await sendInstagramImage({ pageId: '1', accessToken: 't', recipient: 'p', attachmentId: '9', timeoutMs: 1000 })
    assert.equal(r.ok, false)
    assert.equal(calls.length, 1)
  })
})

describe('instagram photos · wiring', () => {
  it('composer offers photos only on Instagram', () => {
    assert.match(IG_OUTBOUND_ACCEPT, /^image\/jpeg,image\/png/)
    const inbox = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
    assert.match(inbox, /accept: selectedConversation\?\.platform === 'instagram' \? IG_OUTBOUND_ACCEPT : WA_OUTBOUND_ACCEPT/)
  })

  it('agent images on Instagram: no WhatsApp media id stored, attachment id kept for reuse', () => {
    const src = readFileSync('src/lib/soft-ai/agent-media-send.ts', 'utf8')
    assert.match(src, /providerMediaId: platform === 'whatsapp' \? mediaId : null/)
    assert.match(src, /\.\.\.\(platform === 'instagram' \? \{ igAttachmentId: igFreshId \|\| mediaId \} : \{\}\)/)
    // Staff photos never keep the attachment id (SecureDog Low 2).
    assert.doesNotMatch(readFileSync('src/lib/chat-send-media-core.ts', 'utf8'), /igAttachmentId/)
  })
})

describe('instagram photos · review fixes', () => {
  it('a refused send says nothing went out (4xx) vs maybe sent (5xx)', async () => {
    mockFetch([{ status: 400, body: {} }, { status: 400, body: {} }])
    const a = await sendInstagramImage({ pageId: '1', accessToken: 't', recipient: 'p', attachmentId: '9', timeoutMs: 1000 })
    assert.equal(!a.ok && a.rejected, true)
    mockFetch([{ status: 502, body: {} }])
    const b = await sendInstagramImage({ pageId: '1', accessToken: 't', recipient: 'p', attachmentId: '9', timeoutMs: 1000 })
    assert.equal(!b.ok && b.rejected, false)
  })

  it('agent images: live planning, delivery and Probar use the same channel rule (WhatsApp + Instagram)', async () => {
    const { imageChannel } = await import('../soft-ai/agent-turn')
    assert.equal(imageChannel('instagram'), true)
    assert.equal(imageChannel('whatsapp'), true)
    assert.equal(imageChannel(undefined), true)
    assert.equal(imageChannel('messenger'), false)
    const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    assert.match(turn, /const liveImageReplyIds =\s+imageChannel\(payload\.platform\)/)
    assert.match(turn, /const probarImageReplyIds = imageChannel\(account\.platform\)/)
    assert.match(turn, /!fallbackUsed && imageChannel\(account\.platform\)/)
  })

  it('staff caption: own text row, sent only after the photo row is saved, never stored unsent', () => {
    const core = readFileSync('src/lib/chat-send-media-core.ts', 'utf8')
    assert.match(core, /content: outboundMediaContent\(media\.kind, platform === 'instagram' \? '' : caption\)/)
    assert.ok(core.indexOf('sendInstagramText({') > core.indexOf('const write = await dualWriteChatMessage'))
    assert.match(core, /if \(sentText\?\.ok\) \{\s+const captionWrite = await dualWriteChatMessage/)
  })

  it('agent: a refused reused attachment id is re-uploaded once (nothing went out)', () => {
    const src = readFileSync('src/lib/soft-ai/agent-media-send.ts', 'utf8')
    assert.match(src, /if \(!r\.ok && r\.rejected && cached\) \{/)
    assert.match(src, /igAttachmentId: igFreshId \|\| mediaId/)
  })
})

describe('instagram photos · SecureDog', () => {
  it('a token Meta echoes in an error never reaches the caller', async () => {
    const token = 'EAAB' + 'x'.repeat(40)
    mockFetch([{ status: 400, body: { error: { message: `Malformed access token ${token}` } } }])
    const r = await uploadInstagramImage({ pageId: '1', accessToken: token, bytes: PNG, mime: 'image/png', timeoutMs: 1000 })
    assert.equal(r.ok, false)
    assert.ok(!r.ok && !r.error.includes(token) && !('data' in r))
  })
})

describe('quick replies · "/" menu and Instagram photos', () => {
  it('the "/" menu lists every quick reply (no 8-item cut)', async () => {
    const { filterQuickReplies } = await import('../chat-quick-replies')
    const items = Array.from({ length: 37 }, (_, i) => ({ shortcut: `r${i}`, text: `t${i}` })) as never[]
    assert.equal(filterQuickReplies(items, '').length, 37)
  })

  it('quick-reply photos are allowed on Instagram (server keeps photos-only)', () => {
    const pane = readFileSync('src/components/chats/SoftThreadPane.tsx', 'utf8')
    assert.match(pane, /\(conversation\?\.platform === 'whatsapp' \|\| conversation\?\.platform === 'instagram'\) &&\s+isSoftHumanComposerEnabled\(agentMode\)/)
  })
})

describe('luna-10 live · confirmation wording', () => {
  it('a lone "confirmada" is blocked but only a payment hand-off when payment / an order is in play', () => {
    const rt = readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8')
    assert.match(rt, /const confirmationIsPayment =\s+validation\.reasons\.includes\('confirmation_wording'\) &&/)
    assert.match(rt, /hasPaymentWord\(finalText\) \|\|\s+hasPaymentWord\(input\.inboundText \|\| ''\)/)
    assert.match(rt, /const paymentRisk =\s+confirmationIsPayment \|\|\s+validation\.reasons\.includes\('payment_status_claim'\)/)
    // The reply itself is still never sent: confirmation_wording keeps needsHuman (safe line + review).
    assert.match(readFileSync('src/lib/soft-ai/llm/output-validator.ts', 'utf8'), /if \(hasConfirmationWording\(text\)\) reasons\.push\('confirmation_wording'\)/)
  })
})
