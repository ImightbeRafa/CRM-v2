import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parseMetaChatPayload } from '../meta-chat'
import { parseInstagramReferral, parseWhatsAppReferral, sanitizeAdReferral } from '../meta-attribution/referral'

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

test('webhook stores the referral best-effort after the message, and never logs the click id', () => {
  const route = read('src/app/api/chat/webhook/route.ts')
  assert.match(route, /if \(direction === 'inbound' && event\.referral && result\.conversationId\) \{\n\s+await recordAdReferral\(/)
  const store = read('src/lib/meta-attribution/referral-store.ts')
  assert.match(store, /ON CONFLICT \("socialAccountId", "dedupeKey"\) DO NOTHING/)
  assert.match(store, /c\."id" = \$\{input\.conversationId\} AND c\."tenantId" = \$\{input\.tenantId\}/)
  assert.doesNotMatch(store, /console\.[a-z]+\([^)]*ctwaClid/)
  assert.match(store, /if \(isMissingTable\(error\)\) return \{ recorded: false, reason: 'table_missing' \}/)
})

test('SQL 039 is additive, gated and locked down', () => {
  const sql = read('supabase/migrations/039_meta_sales_attribution.sql')
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE)\b/i)
  for (const t of ['ChatAdReferral', 'MetaCapiDataset', 'MetaConversionEvent']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\."${t}"`))
    assert.match(sql, new RegExp(`ALTER TABLE public\\."${t}" ENABLE ROW LEVEL SECURITY`))
  }
  const manifest = read('scripts/lib/betsy-v2-additive-manifest.mjs')
  assert.match(manifest, /'039': '039_meta_sales_attribution\.sql'/)
  assert.match(manifest, /'039': \['ChatAdReferral', 'MetaCapiDataset', 'MetaConversionEvent'\]/)
  assert.doesNotMatch(manifest.match(/DEFAULT_APPLY_FILES = '([^']*)'/)?.[1] ?? '', /039/)
})
