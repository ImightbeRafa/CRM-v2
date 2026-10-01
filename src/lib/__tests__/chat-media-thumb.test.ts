import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { isThumbnailable, makeChatThumbnail, parseThumbWidth, THUMB_WIDTHS } from '../chat-media-thumb'

test('only the two preview widths are accepted', () => {
  assert.deepEqual([...THUMB_WIDTHS], [320, 640])
  assert.equal(parseThumbWidth('640'), 640)
  assert.equal(parseThumbWidth('320'), 320)
  for (const bad of [null, '', '0', '1', '4000', '640px', '-640', 'abc']) assert.equal(parseThumbWidth(bad as string), null, String(bad))
})

test('only JPEG / PNG / WebP are resized (never GIF animation, SVG, video, PDF)', () => {
  for (const ok of ['image/jpeg', 'image/png', 'image/webp', 'image/JPEG; charset=binary']) assert.equal(isThumbnailable(ok), true, ok)
  for (const no of ['image/gif', 'image/svg+xml', 'video/mp4', 'application/pdf', 'audio/ogg', '', null]) assert.equal(isThumbnailable(no as string), false, String(no))
})

test('a big photo becomes a small WebP; corrupt input falls back (null)', async () => {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg({ quality: 90 })
    .toBuffer()
  const thumb = await makeChatThumbnail(big, 640)
  assert.ok(thumb, 'thumbnail produced')
  const meta = await sharp(thumb!).metadata()
  assert.equal(meta.format, 'webp')
  assert.equal(meta.width, 640)
  assert.ok(thumb!.length < big.length, 'smaller than the original')
  // Never enlarges a small image.
  const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).png().toBuffer()
  assert.equal((await sharp((await makeChatThumbnail(small, 640))!).metadata()).width, 200)
  assert.equal(await makeChatThumbnail(Buffer.from('not an image'), 640), null)
})

test('route serves previews only on ?w= for photos and keeps the original otherwise', () => {
  const route = readFileSync('src/app/api/chat/media/[messageId]/route.ts', 'utf8')
  assert.match(route, /if \(width && isThumbnailable\(contentType\) && !request\.headers\.get\('range'\)\)/)
  assert.match(route, /return mediaResponse\(request, bytes, contentType, filename\)/)
  assert.doesNotMatch(route, /^\s+return mediaResponse\(\s*$/m, 'every caller goes through respondWithMedia')
  const bubble = readFileSync('src/components/chats/ChatMediaBubble.tsx', 'utf8')
  assert.match(bubble, /src=\{sticker \? src : withThumb\(src, 640\)\}/)
  assert.match(bubble, /<ImageLightbox src=\{src\}/, 'the lightbox keeps the full original')
})
