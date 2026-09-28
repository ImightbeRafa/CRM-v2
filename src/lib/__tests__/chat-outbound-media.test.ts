import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WA_OUTBOUND_LIMITS,
  buildWhatsAppMediaMessage,
  classifyOutboundMedia,
  outboundMediaContent,
  sanitizeOutboundFilename,
} from '@/lib/chat-outbound-media'
import { reconcileOptimisticOutbound } from '@/lib/chat-inbox'

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(32).fill(0x20)])
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj')
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04)
const MP4 = new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode('ftypisom'), ...new Array(20).fill(0)])
const OGG = new TextEncoder().encode('OggS\0\u0002 opus voice')

test('classifies by bytes, never by the name or browser MIME', () => {
  assert.deepEqual(
    (({ ok, kind, mime }) => ({ ok, kind, mime }))(classifyOutboundMedia({ filename: 'foto.jpg', bytes: JPEG }) as any),
    { ok: true, kind: 'image', mime: 'image/jpeg' },
  )
  assert.equal((classifyOutboundMedia({ filename: 'captura.png', bytes: PNG }) as any).mime, 'image/png')
  assert.equal((classifyOutboundMedia({ filename: 'video.mp4', bytes: MP4 }) as any).kind, 'video')
  assert.equal((classifyOutboundMedia({ filename: 'nota.ogg', bytes: OGG }) as any).kind, 'audio')
  assert.equal((classifyOutboundMedia({ filename: 'cotizacion.pdf', bytes: PDF }) as any).kind, 'document')
  assert.equal(
    (classifyOutboundMedia({ filename: 'pedido.xlsx', bytes: ZIP }) as any).mime,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
})

test('rejects disguised, unknown, empty and oversized files', () => {
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
  assert.equal(classifyOutboundMedia({ filename: 'factura.pdf', bytes: html }).ok, false)
  assert.equal(classifyOutboundMedia({ filename: 'x.svg', bytes: new TextEncoder().encode('<svg/>') }).ok, false)
  assert.equal(classifyOutboundMedia({ filename: 'x.exe', bytes: bytes(0x4d, 0x5a) }).ok, false)
  assert.equal(classifyOutboundMedia({ filename: 'vacio.pdf', bytes: new Uint8Array() }).ok, false)
  const big = new Uint8Array(WA_OUTBOUND_LIMITS.image + 1)
  big.set([0xff, 0xd8, 0xff])
  const res = classifyOutboundMedia({ filename: 'grande.jpg', bytes: big })
  assert.equal(res.ok, false)
  assert.match((res as { error: string }).error, /5 MB/)
})

test('file names are stripped of paths, control characters and quotes', () => {
  assert.equal(sanitizeOutboundFilename('C:' + '\\' + 'fakepath' + '\\' + 'Cotización "final".pdf', 'pdf'), 'Cotización final.pdf')
  assert.equal(sanitizeOutboundFilename('../../etc/passwd', 'txt'), 'passwd')
  assert.equal(sanitizeOutboundFilename('', 'pdf'), 'archivo.pdf')
})

test('WhatsApp message body by media id: caption except audio, filename for documents', () => {
  assert.deepEqual(buildWhatsAppMediaMessage({ to: '50688887777', kind: 'image', mediaId: 'M1', caption: 'Hola' }), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '50688887777',
    type: 'image',
    image: { id: 'M1', caption: 'Hola' },
  })
  assert.deepEqual(buildWhatsAppMediaMessage({ to: '1', kind: 'audio', mediaId: 'A', caption: 'ignored' }).audio, { id: 'A' })
  assert.deepEqual(
    buildWhatsAppMediaMessage({ to: '1', kind: 'document', mediaId: 'D', filename: 'x.pdf' }).document,
    { id: 'D', filename: 'x.pdf' },
  )
  assert.equal(outboundMediaContent('image', ''), '[image]')
  assert.equal(outboundMediaContent('document', ' Tu cotización '), 'Tu cotización')
})

test('route: flag-gated, update_sales, tenant-scoped line lookup, WhatsApp only, never trusts client MIME', () => {
  const src = readFileSync('src/app/api/chat/send-media/route.ts', 'utf8')
  assert.match(src, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
  assert.match(src, /isTenantFeatureEnabled\(tenantId, CHAT_OUTBOUND_MEDIA_FLAG\)/)
  assert.match(src, /socialAccount\.findFirst\(\{ where: \{ id: socialAccountId, tenantId \} \}\)/)
  assert.match(src, /found\.platform !== 'whatsapp'/)
  assert.match(src, /classifyOutboundMedia\(\{ filename, bytes \}\)/)
  assert.doesNotMatch(src, /file\.type/)
  const rbac = readFileSync('src/lib/rbac.ts', 'utf8')
  assert.match(rbac, /'POST \/api\/chat\/send-media': 'update_sales'/)
  assert.match(rbac, /'GET \/api\/chat\/capabilities': 'update_sales'/)
})

test('a sent file is appended to the thread when there is no optimistic bubble', () => {
  const next = reconcileOptimisticOutbound(
    [{ id: 'a', direction: 'inbound', content: 'hola', sentAt: '2026-09-28T00:00:00Z' } as any],
    { id: 'b', direction: 'outbound', content: '[image]', sentAt: '2026-09-28T00:01:00Z', messageType: 'image' } as any,
  )
  assert.deepEqual(next.map((m) => m.id), ['a', 'b'])
})
