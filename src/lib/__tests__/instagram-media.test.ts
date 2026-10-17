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
    assert.match(src, /\.\.\.\(platform === 'instagram' \? \{ igAttachmentId: mediaId \} : \{\}\)/)
  })
})
