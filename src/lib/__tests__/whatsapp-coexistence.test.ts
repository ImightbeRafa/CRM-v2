import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  buildWhatsAppCoexistenceLoginExtras,
  buildWhatsAppDirectOauthDialogUrl,
  buildWhatsAppEmbeddedSignupLoginOptions,
  closeWhatsAppDirectOauthPopup,
  decideWhatsAppDirectOauthPopupClosed,
  extractWaEmbeddedSignupAssets,
  isFbSdkEmbeddedSignup36008,
  isWaCoexistenceFinishEvent,
  isWaEmbeddedSignupFinishEvent,
  isWaEmbeddedSignupMessage,
  navigateWhatsAppDirectOauthPopup,
  openWhatsAppDirectOauthPlaceholder,
  parseWaDirectOauthMessage,
  shouldDeferWhatsAppCodeExchange,
  shouldIgnoreWaSessionEvent,
  waSignupReadyToExchange,
  WA_COEXISTENCE_FEATURE_TYPE,
  WA_DIRECT_OAUTH_MESSAGE_TYPE,
  WA_DIRECT_OAUTH_PLACEHOLDER_URL,
  WA_DIRECT_OAUTH_POPUP_NAME,
  WA_SESSION_INFO_VERSION,
  type OpenNamedWindow,
} from '../whatsapp-embedded-signup'
import { selectCoexistencePhoneNumber, WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT } from '../meta-api'
import { buildWebhookStoredMetadata, parseMetaChatPayload } from '../meta-chat'
import { getConversationPeerId, groupMessagesByRecipient } from '../chat-inbox'
import {
  partnerRemovedWhatsAppWhere,
  whatsappRefreshTokensForWabaId,
} from '../social-account-meta'

test('coexistence FB.login extras match Meta docs', () => {
  const extras = buildWhatsAppCoexistenceLoginExtras()
  assert.deepEqual(extras, {
    setup: {},
    featureType: WA_COEXISTENCE_FEATURE_TYPE,
    sessionInfoVersion: WA_SESSION_INFO_VERSION,
  })
  assert.equal(extras.featureType, 'whatsapp_business_app_onboarding')
  assert.equal(extras.sessionInfoVersion, '3')

  const options = buildWhatsAppEmbeddedSignupLoginOptions('cfg-123')
  assert.equal(options.config_id, 'cfg-123')
  assert.equal(options.response_type, 'code')
  assert.equal(options.override_default_response_type, true)
  assert.equal(options.extras.featureType, 'whatsapp_business_app_onboarding')
})

test('extractWaEmbeddedSignupAssets reads coexistence FINISH (waba only)', () => {
  const assets = extractWaEmbeddedSignupAssets({
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    version: 3,
    data: { waba_id: '102290129340398' },
  })
  assert.equal(assets.phoneNumberId, null)
  assert.equal(assets.wabaId, '102290129340398')
  assert.equal(assets.coexistence, true)
  assert.equal(isWaCoexistenceFinishEvent(assets.event), true)
  assert.equal(isWaEmbeddedSignupFinishEvent(assets.event), true)
})

test('extractWaEmbeddedSignupAssets reads classic FINISH with phone + waba', () => {
  const assets = extractWaEmbeddedSignupAssets({
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH',
    data: {
      phone_number_id: '106540352242922',
      waba_id: '102290129340398',
    },
  })
  assert.equal(assets.phoneNumberId, '106540352242922')
  assert.equal(assets.wabaId, '102290129340398')
  assert.equal(assets.coexistence, false)
})

test('waSignupReadyToExchange correlates code + coexistence waba', () => {
  assert.equal(waSignupReadyToExchange({ code: null, message: null }), false)
  assert.equal(
    waSignupReadyToExchange({
      code: 'AQB...',
      message: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        data: { waba_id: '1' },
      },
    }),
    true,
  )
  assert.equal(
    waSignupReadyToExchange({
      code: 'AQB...',
      message: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: {},
      },
    }),
    false,
  )
  assert.equal(waSignupReadyToExchange({ code: 'AQB...' }), false)
  assert.equal(waSignupReadyToExchange({ accessToken: 'EAA...' }), false)
})

test('shouldDeferWhatsAppCodeExchange blocks code-only Meta exchange', () => {
  assert.equal(shouldDeferWhatsAppCodeExchange({ code: 'AQB...' }), true)
  assert.equal(
    shouldDeferWhatsAppCodeExchange({
      code: 'AQB...',
      phoneNumberId: '106540352242922',
    }),
    false,
  )
  assert.equal(
    shouldDeferWhatsAppCodeExchange({
      code: 'AQB...',
      wabaId: '102290129340398',
    }),
    false,
  )
  assert.equal(
    shouldDeferWhatsAppCodeExchange({
      code: 'AQB...',
      accessToken: 'EAA...',
    }),
    false,
  )
  assert.equal(shouldDeferWhatsAppCodeExchange({ accessToken: 'EAA...' }), false)
})

test('CANCEL/ERROR session events are ignored', () => {
  assert.equal(shouldIgnoreWaSessionEvent('CANCEL'), true)
  assert.equal(shouldIgnoreWaSessionEvent('ERROR'), true)
  assert.equal(shouldIgnoreWaSessionEvent('FINISH'), false)
  assert.equal(isWaEmbeddedSignupMessage({ type: 'WA_EMBEDDED_SIGNUP' }), true)
  assert.equal(isWaEmbeddedSignupMessage({ type: 'other' }), false)
})

test('selectCoexistencePhoneNumber prefers is_on_biz_app + CLOUD_API', () => {
  const selected = selectCoexistencePhoneNumber([
    {
      id: 'phone-cloud-only',
      displayPhoneNumber: '+1',
      isOnBizApp: false,
      platformType: 'CLOUD_API',
    },
    {
      id: 'phone-coexist',
      displayPhoneNumber: '+506 6104 3737',
      isOnBizApp: true,
      platformType: 'CLOUD_API',
    },
  ])
  assert.equal(selected.ok, true)
  if (selected.ok) assert.equal(selected.phone.id, 'phone-coexist')

  const ambiguous = selectCoexistencePhoneNumber([
    { id: 'a', displayPhoneNumber: null, isOnBizApp: true, platformType: 'CLOUD_API' },
    { id: 'b', displayPhoneNumber: null, isOnBizApp: true, platformType: 'CLOUD_API' },
  ])
  assert.equal(ambiguous.ok, false)

  const single = selectCoexistencePhoneNumber([
    { id: 'only', displayPhoneNumber: null, isOnBizApp: null, platformType: null },
  ])
  assert.equal(single.ok, true)
  if (single.ok) assert.equal(single.phone.id, 'only')
})

test('default WhatsApp subscribed_fields include coexistence topics', () => {
  assert.match(WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT, /messages/)
  assert.match(WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT, /history/)
  assert.match(WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT, /smb_app_state_sync/)
  assert.match(WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT, /smb_message_echoes/)
  assert.match(WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT, /account_update/)
})

test('parseMetaChatPayload parses smb_message_echoes as outbound and suppresses Soft AI', () => {
  const parsed = parseMetaChatPayload({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'smb_message_echoes',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550783881',
                phone_number_id: '106540352242922',
              },
              message_echoes: [
                {
                  from: '15550783881',
                  to: '16505551234',
                  id: 'wamid.echo1',
                  timestamp: '1749854575',
                  type: 'text',
                  text: { body: 'enviado desde la app' },
                },
              ],
            },
          },
        ],
      },
    ],
  })

  assert.equal(parsed.messages.length, 1)
  const message = parsed.messages[0]!
  assert.equal(message.direction, 'outbound')
  assert.equal(message.suppressSoftAi, true)
  assert.equal(message.senderId, '16505551234')
  assert.equal(message.content, 'enviado desde la app')
  assert.equal(message.metadata.smbEcho, true)
  assert.equal(message.metadata.to, '16505551234')
  assert.equal(message.metadata.from, '15550783881')

  const stored = buildWebhookStoredMetadata(message)
  assert.equal(stored.to, '16505551234')
  assert.equal(stored.from, '15550783881')
  assert.equal(
    getConversationPeerId({ direction: 'outbound', metadata: stored }),
    '16505551234',
  )
})

test('parseMetaChatPayload parses history threads and suppresses Soft AI', () => {
  const parsed = parseMetaChatPayload({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'history',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550783881',
                phone_number_id: '106540352242922',
              },
              history: [
                {
                  metadata: { phase: 0, chunk_order: 1, progress: 50 },
                  threads: [
                    {
                      id: '16505551234',
                      messages: [
                        {
                          from: '16505551234',
                          id: 'wamid.in1',
                          timestamp: '1749854000',
                          type: 'text',
                          text: { body: 'hola historial' },
                        },
                        {
                          from: '15550783881',
                          to: '16505551234',
                          id: 'wamid.out1',
                          timestamp: '1749854100',
                          type: 'text',
                          text: { body: 'respuesta historial' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  })

  assert.equal(parsed.messages.length, 2)
  assert.equal(parsed.messages[0]!.direction, 'inbound')
  assert.equal(parsed.messages[0]!.suppressSoftAi, true)
  assert.equal(parsed.messages[0]!.content, 'hola historial')
  assert.equal(parsed.messages[0]!.metadata.from, '16505551234')
  assert.equal(parsed.messages[1]!.direction, 'outbound')
  assert.equal(parsed.messages[1]!.suppressSoftAi, true)
  assert.equal(parsed.messages[1]!.content, 'respuesta historial')
  assert.equal(parsed.messages[1]!.metadata.to, '16505551234')

  const inboundStored = buildWebhookStoredMetadata(parsed.messages[0]!)
  const outboundStored = buildWebhookStoredMetadata(parsed.messages[1]!)
  assert.equal(
    getConversationPeerId({ direction: 'inbound', metadata: inboundStored }),
    '16505551234',
  )
  assert.equal(
    getConversationPeerId({ direction: 'outbound', metadata: outboundStored }),
    '16505551234',
  )

  const convs = groupMessagesByRecipient(
    [
      {
        id: 'h1',
        direction: 'inbound',
        content: parsed.messages[0]!.content,
        sentAt: '2026-09-20T10:00:00.000Z',
        receivedAt: '2026-09-20T10:00:01.000Z',
        metadata: inboundStored,
      },
      {
        id: 'h2',
        direction: 'outbound',
        content: parsed.messages[1]!.content,
        sentAt: '2026-09-20T10:01:00.000Z',
        receivedAt: null,
        metadata: outboundStored,
      },
    ],
    'whatsapp',
  )
  assert.equal(convs.length, 1)
  assert.equal(convs[0]!.recipientId, '16505551234')
})

test('PARTNER_REMOVED matches canonical and legacy WABA tokens exactly', () => {
  const wabaId = '102290129340398'
  assert.deepEqual(whatsappRefreshTokensForWabaId(wabaId), [
    `waba:${wabaId}`,
    wabaId,
  ])
  const where = partnerRemovedWhatsAppWhere(wabaId)
  assert.ok(where)
  assert.deepEqual(where?.refreshToken.in, [`waba:${wabaId}`, wabaId])
  assert.equal(where?.refreshToken.in.includes(`waba:${wabaId}0`), false)
  assert.equal(partnerRemovedWhatsAppWhere(''), null)
  assert.deepEqual(whatsappRefreshTokensForWabaId('waba-not-numeric'), ['waba:waba-not-numeric'])
})

test('parseMetaChatPayload surfaces PARTNER_REMOVED account_update', () => {
  const parsed = parseMetaChatPayload({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'account_update',
            value: {
              phone_number: '15550783881',
              event: 'PARTNER_REMOVED',
              disconnection_info: {
                reason: 'PRIMARY_INACTIVITY',
                initiated_by: 'SYSTEM',
              },
            },
          },
        ],
      },
    ],
  })

  assert.equal(parsed.messages.length, 0)
  assert.equal(parsed.accountEvents?.length, 1)
  assert.equal(parsed.accountEvents?.[0]?.event, 'PARTNER_REMOVED')
  assert.equal(parsed.accountEvents?.[0]?.wabaId, '102290129340398')
  assert.equal(parsed.accountEvents?.[0]?.reason, 'PRIMARY_INACTIVITY')
})

test('live WhatsApp messages remain inbound Soft-AI eligible', () => {
  const parsed = parseMetaChatPayload({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'phone1', display_phone_number: '1' },
              messages: [
                {
                  from: '50611112222',
                  id: 'wamid.live',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'live' },
                },
              ],
            },
          },
        ],
      },
    ],
  })
  assert.equal(parsed.messages[0]!.direction, 'inbound')
  assert.equal(parsed.messages[0]!.suppressSoftAi, false)
})

test('direct OAuth dialog URL matches Embedded Signup FB.login extras', () => {
  const url = new URL(
    buildWhatsAppDirectOauthDialogUrl({
      appId: 'app-1',
      redirectUri: 'https://example.test/api/auth/whatsapp/callback',
      state: 'csrf-state',
      configId: 'cfg-123',
      graphApiVersion: 'v24.0',
    }),
  )
  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v24.0/dialog/oauth')
  assert.equal(url.searchParams.get('client_id'), 'app-1')
  assert.equal(url.searchParams.get('config_id'), 'cfg-123')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('override_default_response_type'), 'true')
  assert.equal(url.searchParams.get('state'), 'csrf-state')
  assert.equal(url.searchParams.get('scope'), null)
  const extras = JSON.parse(url.searchParams.get('extras') || '{}')
  assert.equal(extras.featureType, WA_COEXISTENCE_FEATURE_TYPE)
  assert.equal(extras.sessionInfoVersion, WA_SESSION_INFO_VERSION)
})

test('parseWaDirectOauthMessage and 36008 detection', () => {
  assert.equal(parseWaDirectOauthMessage({ type: 'ig_oauth_complete' }), null)
  assert.deepEqual(parseWaDirectOauthMessage({ type: WA_DIRECT_OAUTH_MESSAGE_TYPE, ok: true, code: 'AQB' }), {
    type: WA_DIRECT_OAUTH_MESSAGE_TYPE,
    ok: true,
    code: 'AQB',
    error: '',
  })
  assert.equal(isFbSdkEmbeddedSignup36008({ code: 36008 }), true)
  assert.equal(isFbSdkEmbeddedSignup36008({ error: { code: '36008', message: 'popup' } }), true)
  assert.equal(isFbSdkEmbeddedSignup36008({ status: 'unknown' }), false)
  assert.equal(isFbSdkEmbeddedSignup36008(null), false)
})

test('social page consumes wa_direct_oauth and does not spend the code before assets', () => {
  const page = readFileSync('src/app/config/social/page.tsx', 'utf8')
  assert.match(page, /parseWaDirectOauthMessage/)
  assert.match(page, /isFbSdkEmbeddedSignup36008/)
  assert.match(page, /\/api\/auth\/whatsapp\/direct-oauth/)
  assert.match(page, /launchWhatsAppDirectOauthFallback/)
  const usageAt = page.lastIndexOf('parseWaDirectOauthMessage')
  const exchangeAt = page.indexOf('tryExchangeWhatsAppSignupRef.current()', usageAt)
  assert.ok(usageAt > 0)
  assert.ok(exchangeAt > usageAt)
  assert.doesNotMatch(page, /tryExchangeWhatsAppSignupRef\.current\(true\)/)
  assert.doesNotMatch(page, /tryExchangeWhatsAppSignupRef\.current\(false\)/)
  assert.doesNotMatch(page, /forceTokenOnly/)
})

test('36008 fallback reserves popup on the click and navigates that handle after fetch', () => {
  const opens: string[] = []
  const popup = {
    closed: false,
    location: {
      href: WA_DIRECT_OAUTH_PLACEHOLDER_URL,
      replace(url: string) {
        this.href = url
      },
    },
    close() {
      this.closed = true
    },
  }
  const openWindow: OpenNamedWindow = (url, name) => {
    opens.push(`${name}:${url}`)
    return popup as unknown as Window
  }

  const reserved = openWhatsAppDirectOauthPlaceholder(openWindow)
  const oauthUrl = 'https://www.facebook.com/v24.0/dialog/oauth?client_id=app-1'
  assert.equal(navigateWhatsAppDirectOauthPopup(reserved, oauthUrl), true)
  assert.deepEqual(opens, [`${WA_DIRECT_OAUTH_POPUP_NAME}:${WA_DIRECT_OAUTH_PLACEHOLDER_URL}`])
  assert.equal(popup.location.href, oauthUrl)

  closeWhatsAppDirectOauthPopup(reserved)
  assert.equal(popup.closed, true)
  assert.equal(navigateWhatsAppDirectOauthPopup(reserved, 'https://example.test'), false)
  assert.equal(navigateWhatsAppDirectOauthPopup(null, oauthUrl), false)

  const page = readFileSync('src/app/config/social/page.tsx', 'utf8')
  const reserveAt = page.indexOf('openWhatsAppDirectOauthPlaceholder(')
  const loginAt = page.indexOf('FB.login(')
  const fallbackAt = page.indexOf('launchWhatsAppDirectOauthFallback(reservedPopup)')
  assert.ok(reserveAt > 0 && loginAt > reserveAt, 'placeholder must open before FB.login')
  assert.ok(fallbackAt > loginAt)
  assert.match(page, /navigateWhatsAppDirectOauthPopup\(popup/)
  assert.doesNotMatch(page, /window\.open\(\s*String\(json\.oauthUrl\)/)
  assert.doesNotMatch(page, /forceTokenOnly/)
})

test('direct OAuth popup close settles connecting except in-flight exchange', () => {
  assert.deepEqual(decideWhatsAppDirectOauthPopupClosed({ exchanging: true, code: 'AQB' }), {
    settleConnecting: false,
    reason: 'exchanging',
  })
  assert.deepEqual(
    decideWhatsAppDirectOauthPopupClosed({
      code: null,
      message: {
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        data: { waba_id: '1' },
      },
    }),
    { settleConnecting: true, reason: 'assets_without_code' },
  )
  assert.deepEqual(decideWhatsAppDirectOauthPopupClosed({ code: 'AQB...' }), {
    settleConnecting: true,
    reason: 'code_without_assets',
  })
  assert.deepEqual(decideWhatsAppDirectOauthPopupClosed({}), {
    settleConnecting: true,
    reason: 'closed',
  })

  const page = readFileSync('src/app/config/social/page.tsx', 'utf8')
  assert.match(page, /decideWhatsAppDirectOauthPopupClosed/)
  const assetsWithoutCodeAt = page.indexOf("case 'assets_without_code'")
  const setConnectingAt = page.indexOf('setConnectingWhatsApp(false)', assetsWithoutCodeAt)
  assert.ok(assetsWithoutCodeAt > 0 && setConnectingAt > assetsWithoutCodeAt)
})

test('direct-oauth route requires config_id for Embedded Signup parity', () => {
  const source = readFileSync('src/app/api/auth/whatsapp/direct-oauth/route.ts', 'utf8')
  assert.match(source, /buildWhatsAppDirectOauthDialogUrl/)
  assert.match(source, /NEXT_PUBLIC_FB_LOGIN_CONFIG_ID/)
  assert.match(source, /getMetaGraphApiVersion/)
})

