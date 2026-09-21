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
        for (let i = 0; i < 12; i += 1) controller.enqueue(chunk)
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
