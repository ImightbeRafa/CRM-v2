import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMediaCacheMetadataPatch,
  CHAT_MEDIA_MAX_BYTES,
  downloadMetaMediaWithCap,
  isMetaCdnUrl,
  stripMetaCdnFromMetadata,
} from '../chat-media'

describe('chat-media', () => {
  it('detects Meta CDN hosts and strips them from metadata', () => {
    assert.equal(isMetaCdnUrl('https://scontent.xx.fbcdn.net/v/t1/img.jpg'), true)
    assert.equal(isMetaCdnUrl('https://lookaside.fbsbx.com/file.jpg'), true)
    assert.equal(isMetaCdnUrl('chat-media/tenant/msg'), false)
    const cleaned = stripMetaCdnFromMetadata({
      mediaUrl: 'https://scontent.cdninstagram.com/v/t51.2885/x.jpg',
      providerMediaId: '12345',
      caption: 'hola',
    })
    assert.equal(cleaned.mediaUrl, undefined)
    assert.equal(cleaned.providerMediaId, '12345')
    assert.equal(cleaned.caption, 'hola')
  })

  it('buildMediaCacheMetadataPatch never persists Meta CDN URLs', () => {
    const patch = buildMediaCacheMetadataPatch(
      {
        mediaUrl: 'https://scontent.xx.fbcdn.net/v/bad.jpg',
        providerMediaId: 'media-1',
      },
      {
        mediaBlobPath: 'chat-media/t1/m1',
        mediaCacheStatus: 'ready',
        mediaMimeType: 'image/jpeg',
      },
    )
    assert.equal(patch.mediaBlobPath, 'chat-media/t1/m1')
    assert.equal(patch.mediaCacheStatus, 'ready')
    assert.equal(patch.mediaUrl, undefined)
    assert.equal(isMetaCdnUrl(patch.mediaBlobPath), false)
  })

  it('downloadMetaMediaWithCap rejects oversized Content-Length', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 200,
        headers: {
          'content-length': String(CHAT_MEDIA_MAX_BYTES + 1),
          'content-type': 'image/jpeg',
        },
      })

    await assert.rejects(
      () =>
        downloadMetaMediaWithCap({
          url: 'https://scontent.xx.fbcdn.net/v/t1/img.jpg',
          accessToken: 'token',
          fetchImpl,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.equal((err as Error & { code?: string }).code, 'too_large')
        return true
      },
    )
  })

  it('downloadMetaMediaWithCap enforces hard cap mid-stream', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const over = Math.ceil(CHAT_MEDIA_MAX_BYTES / chunk.length) + 2
        for (let i = 0; i < over; i += 1) controller.enqueue(chunk)
        controller.close()
      },
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })

    await assert.rejects(
      () =>
        downloadMetaMediaWithCap({
          url: 'https://scontent.xx.fbcdn.net/v/t1/big.bin',
          accessToken: 'token',
          maxBytes: CHAT_MEDIA_MAX_BYTES,
          fetchImpl,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.equal((err as Error & { code?: string }).code, 'too_large')
        return true
      },
    )
  })
})

describe('chat-media: Range + Instagram attachments', async () => {
  const { parseSingleByteRange, instagramAttachmentUrl, cacheInstagramAttachmentToBlob } = await import('../chat-media')

  it('parses the single ranges browsers send (iOS probe bytes=0-1)', () => {
    assert.deepEqual(parseSingleByteRange('bytes=0-1', 100), { start: 0, end: 1 })
    assert.deepEqual(parseSingleByteRange('bytes=50-', 100), { start: 50, end: 99 })
    assert.deepEqual(parseSingleByteRange('bytes=-10', 100), { start: 90, end: 99 })
    assert.deepEqual(parseSingleByteRange('bytes=0-500', 100), { start: 0, end: 99 })
    assert.equal(parseSingleByteRange('bytes=200-300', 100), 'unsatisfiable')
    assert.equal(parseSingleByteRange(null, 100), null)
    assert.equal(parseSingleByteRange('bytes=0-1,5-6', 100), null)
  })

  it('accepts only https Meta CDN attachment URLs (no SSRF)', () => {
    const meta = (url: string) => ({ rawMessage: { attachments: [{ type: 'image', payload: { url } }] } })
    assert.equal(instagramAttachmentUrl(meta('https://scontent.cdninstagram.com/v/a.jpg')), 'https://scontent.cdninstagram.com/v/a.jpg')
    assert.equal(instagramAttachmentUrl(meta('https://evil.example.com/a.jpg')), null)
    assert.equal(instagramAttachmentUrl(meta('http://scontent.cdninstagram.com/a.jpg')), null)
    assert.equal(instagramAttachmentUrl(meta('https://169.254.169.254/latest')), null)
    assert.equal(instagramAttachmentUrl({ rawMessage: { text: 'hola' } }), null)
  })

  it('downloads IG attachments without sending any Authorization header', async () => {
    let sentHeaders: Record<string, string> = {}
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentHeaders = (init?.headers || {}) as Record<string, string>
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }) as unknown as typeof fetch
    const res = await cacheInstagramAttachmentToBlob({
      tenantId: 't1',
      messageId: 'm1',
      url: 'https://scontent.cdninstagram.com/v/a.jpg',
      fetchImpl,
      putFn: async (o) => ({ pathname: `chat-media/${o.tenantId}/${o.messageId}`, size: o.bytes.length }),
    })
    assert.equal(res.ok, true)
    assert.equal(Object.keys(sentHeaders).length, 0)
    if (res.ok) assert.equal(res.ref.mediaBlobPath, 'chat-media/t1/m1')
  })
})
