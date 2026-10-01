import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parseMetaChatPayload } from '../meta-chat'
import { isMetaAdUrl, parseInstagramReferral, parseWhatsAppReferral, sanitizeAdReferral } from '../meta-attribution/referral'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

function waPayload(message: Record<string, unknown>, field = 'messages') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA1',
        changes: [
          {
            field,
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '50688887777', phone_number_id: 'PN1' },
              contacts: [{ wa_id: '50661234567', profile: { name: 'Ana' } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  }
}

const ctwa = {
  from: '50661234567',
  id: 'wamid.AD1',
  timestamp: '1759300000',
  type: 'text',
  text: { body: 'Hola, vi el anuncio' },
  referral: {
    source_url: 'https://fb.me/abc123',
    source_id: '120210000000000001',
    source_type: 'ad',
    headline: 'Colchones en oferta',
    body: 'Envío gratis en GAM',
    media_type: 'image',
    image_url: 'https://scontent.xx.fbcdn.net/signed-cdn-url',
    ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a',
  },
}

test('WhatsApp click-to-WhatsApp ad: referral parsed with the click id, CDN media URL dropped', () => {
  const parsed = parseMetaChatPayload(waPayload(ctwa))
  assert.equal(parsed.messages.length, 1)
  const ref = parsed.messages[0]!.referral
  assert.ok(ref)
  assert.equal(ref.platform, 'whatsapp')
  assert.equal(ref.sourceType, 'ad')
  assert.equal(ref.sourceId, '120210000000000001')
  assert.equal(ref.sourceUrl, 'https://fb.me/abc123')
  assert.equal(ref.headline, 'Colchones en oferta')
  assert.equal(ref.mediaType, 'image')
  assert.equal(ref.ctwaClid, ctwa.referral.ctwa_clid)
  assert.ok(!JSON.stringify(ref).includes('fbcdn'), 'signed CDN media URLs are never kept')
  // The stored raw message no longer carries the referral (single copy lives in ChatAdReferral).
  const metadata = parsed.messages[0]!.metadata
  const raw = metadata.rawMessage as Record<string, unknown>
  assert.equal('referral' in raw, false)
  assert.equal(raw.hasAdReferral, true)
  assert.ok(!JSON.stringify(metadata).includes(ctwa.referral.ctwa_clid))
  assert.ok(!JSON.stringify(metadata).includes('fbcdn'))
})

test('a message without a referral is unchanged (no referral key at all)', () => {
  const { referral: _ignored, ...plain } = ctwa
  const parsed = parseMetaChatPayload(waPayload(plain))
  assert.equal(parsed.messages.length, 1)
  assert.equal('referral' in parsed.messages[0]!, false)
})

test('non-ad referral (post) is kept as a referral without a click id', () => {
  const ref = parseWhatsAppReferral({
    referral: { source_type: 'post', source_id: '987', source_url: 'https://www.facebook.com/p/987' },
  })
  assert.equal(ref?.sourceType, 'post')
  assert.equal(ref?.ctwaClid, null)
})

test('echoes and history never carry a referral (only live customer messages)', () => {
  const echo = parseMetaChatPayload({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA1',
        changes: [
          {
            field: 'smb_message_echoes',
            value: {
              metadata: { phone_number_id: 'PN1' },
              message_echoes: [{ ...ctwa, from: '50688887777', to: '50661234567' }],
            },
          },
        ],
      },
    ],
  })
  assert.equal(echo.messages.length, 1)
  assert.equal(echo.messages[0]!.referral, undefined)

  const igEcho = parseMetaChatPayload({
    object: 'instagram',
    entry: [
      {
        id: 'IG1',
        messaging: [
          {
            sender: { id: 'IG1' },
            recipient: { id: 'USER1' },
            timestamp: 1759300000000,
            message: { mid: 'm1', text: 'hola', is_echo: true, referral: { source: 'ADS', ad_id: '55' } },
          },
        ],
      },
    ],
  })
  assert.equal(igEcho.messages[0]?.referral, undefined)
})

test('Instagram ad referral: ad id, title and ref param', () => {
  const parsed = parseMetaChatPayload({
    object: 'instagram',
    entry: [
      {
        id: 'IG1',
        messaging: [
          {
            sender: { id: 'USER1' },
            recipient: { id: 'IG1' },
            timestamp: 1759300000000,
            message: {
              mid: 'm2',
              text: 'Precio?',
              referral: {
                ref: 'promo-octubre',
                ad_id: '120210000000000002',
                source: 'ADS',
                type: 'OPEN_THREAD',
                ads_context_data: { ad_title: 'Almohadas', photo_url: 'https://scontent.cdninstagram.com/x' },
              },
            },
          },
        ],
      },
    ],
  })
  const ref = parsed.messages[0]?.referral
  assert.equal(ref?.platform, 'instagram')
  assert.equal(ref?.sourceType, 'ad')
  assert.equal(ref?.sourceId, '120210000000000002')
  assert.equal(ref?.headline, 'Almohadas')
  assert.equal(ref?.refParam, 'promo-octubre')
  assert.equal(ref?.ctwaClid, null)
  assert.equal(parseInstagramReferral({}), null)
})

test('sanitising: lengths clamped, non-https and junk ids dropped, empty referral is null', () => {
  const ref = sanitizeAdReferral('whatsapp', {
    sourceUrl: 'http://insecure.example/x',
    sourceId: '12<script>',
    headline: 'x'.repeat(500),
    body: 'line1\u0000line2',
    ctwaClid: 'ok_Clid-1',
  })
  assert.equal(ref?.sourceUrl, null)
  assert.equal(ref?.sourceId, null)
  assert.equal(ref?.headline?.length, 300)
  assert.equal(ref?.body, 'line1 line2')
  assert.equal(ref?.ctwaClid, 'ok_Clid-1')
  assert.equal(sanitizeAdReferral('whatsapp', { sourceUrl: 'javascript:alert(1)' }), null)
  assert.equal(parseWhatsAppReferral({ referral: 'nope' }), null)
})

test('forgeable referral (WhatsApp is end-to-end encrypted): only Meta links, no spoofing characters', () => {
  assert.equal(isMetaAdUrl('https://fb.me/abc'), true)
  assert.equal(isMetaAdUrl('https://www.instagram.com/p/x'), true)
  assert.equal(isMetaAdUrl('https://www.facebook.com@meta-verify.example/login'), false, 'credentials trick')
  assert.equal(isMetaAdUrl('https://facebook.com.evil.example/x'), false)
  assert.equal(isMetaAdUrl('https://evilfacebook.com/x'), false)
  assert.equal(isMetaAdUrl('https://fb.me:8443/x'), false)
  assert.equal(isMetaAdUrl('http://fb.me/x'), false)
  const ref = sanitizeAdReferral('whatsapp', {
    headline: 'Oferta‮txt.exe​',
    sourceUrl: 'https://www.facebook.com/' + 'ñ'.repeat(1500),
    ctwaClid: 'abc',
  })
  assert.equal(ref?.headline, 'Oferta txt.exe')
  assert.equal(ref?.sourceUrl, null, 'too long once percent-encoded')
})

test('webhook stores the referral best-effort after the message, and never logs the click id', () => {
  const route = read('src/app/api/chat/webhook/route.ts')
  assert.match(route, /if \(direction === 'inbound' && event\.referral && result\.conversationId\) \{\n\s+await recordAdReferral\(/)
  // A Meta retry of an already-stored message still records the referral (idempotent).
  assert.match(route, /if \(direction === 'inbound' && event\.referral\) \{\n\s+await recordAdReferralForRetry\(account, event\)/)
  const store = read('src/lib/meta-attribution/referral-store.ts')
  assert.match(store, /ON CONFLICT \("socialAccountId", "dedupeKey"\) DO NOTHING/)
  assert.match(
    store,
    /c\."id" = \$\{input\.conversationId\} AND c\."tenantId" = \$\{input\.tenantId\}\n\s+AND c\."socialAccountId" = \$\{input\.socialAccountId\}/,
  )
  assert.match(store, /SET LOCAL lock_timeout = '2s'/)
  assert.match(store, /tableMissingUntil = Date\.now\(\) \+ MISSING_TABLE_BACKOFF_MS/)
  assert.doesNotMatch(store, /console\.[a-z]+\([^)]*ctwaClid/)
  assert.doesNotMatch(
    read('src/lib/chat-conversation-write.ts'),
    /console\.error\('\[chat-conversation-write\] dualWrite failed', error\)/,
    'dual-write failures must not print the row (phone, text, raw message)',
  )
  const retention = read('src/lib/workspace-retention.ts')
  assert.match(retention, /export const AD_CLICK_ID_DAYS = 90/)
  assert.match(retention, /data: \{ ctwaClid: null \}/)
})

test('SQL 039 is additive, gated and locked down', () => {
  const sql = read('supabase/migrations/039_meta_sales_attribution.sql')
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE)\b/i)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAdReferral"/)
  assert.match(sql, /ALTER TABLE public\."ChatAdReferral" ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(sql, /REFERENCES public\."(ChatMessage|Order)"/, 'keeps the busiest tables out of the lock set')
  assert.match(sql, /Apply in a quiet window/)
  const manifest = read('scripts/lib/betsy-v2-additive-manifest.mjs')
  assert.match(manifest, /'039': '039_meta_sales_attribution\.sql'/)
  assert.match(manifest, /'039': \['ChatAdReferral'\]/)
  assert.doesNotMatch(manifest.match(/DEFAULT_APPLY_FILES = '([^']*)'/)?.[1] ?? '', /039/)
})
