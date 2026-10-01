import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { hasRasterPhotoSignature, isThumbnailable, makeChatThumbnail, parseThumbWidth, THUMB_WIDTHS } from '../chat-media-thumb'

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

test('declared type is not trusted: SVG / TIFF / GIF bytes labelled as PNG are never decoded', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="6000"><rect width="10" height="10"/></svg>')
  const gif = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#f00' } }).gif().toBuffer()
  const tiff = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#0f0' } }).tiff().toBuffer()
  for (const [name, bytes] of [['svg', svg], ['gif', gif], ['tiff', tiff]] as const) {
    assert.equal(hasRasterPhotoSignature(bytes), false, name)
    assert.equal(await makeChatThumbnail(bytes, 640), null, name)
  }
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#00f' } }).png().toBuffer()
  const webp = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#00f' } }).webp().toBuffer()
  const jpeg = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#00f' } }).jpeg().toBuffer()
  for (const ok of [png, webp, jpeg]) assert.equal(hasRasterPhotoSignature(ok), true)
})

test('previews are throttled (2 at a time) and time-boxed', () => {
  const src = readFileSync('src/lib/chat-media-thumb.ts', 'utf8')
  assert.match(src, /const MAX_CONCURRENT = 2/)
  assert.match(src, /\.timeout\(\{ seconds: 5 \}\)/)
  assert.match(src, /sharp\.concurrency\(1\)/)
  assert.ok(src.indexOf('hasRasterPhotoSignature(bytes)') < src.indexOf("import('sharp')"))
})

test('billing screen reads fresh; the per-page banner may use the cache', () => {
  const route = readFileSync('src/app/api/billing/access/route.ts', 'utf8')
  assert.match(route, /searchParams\.get\('fresh'\) === '1'/)
  assert.match(route, /\? await evaluateTenantAccess\(membership\.tenantId\)/)
  assert.match(readFileSync('src/app/config/components/BillingDashboard.tsx', 'utf8'), /\/api\/billing\/access\?fresh=1/)
})

test('chat list reads the max revision before the page', () => {
  const route = readFileSync('src/app/api/chat/conversations/route.ts', 'utf8')
  assert.ok(route.indexOf('const maxRevisionAgg = await prisma.chatConversation.aggregate') < route.indexOf('prisma.chatConversation.findMany({'))
})

test('never more than 2 previews build at the same time', async () => {
  const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#888' } }).jpeg().toBuffer()
  const results = await Promise.all(Array.from({ length: 8 }, () => makeChatThumbnail(jpeg, 320)))
  assert.ok(results.every((r) => r && r.length > 0), 'all 8 queued requests finish')
})
