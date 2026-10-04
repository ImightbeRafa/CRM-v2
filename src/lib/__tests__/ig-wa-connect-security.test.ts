import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  createInstagramPendingConnect,
  decodeInstagramPendingCookieClaimsForTest,
  encryptPendingRecord,
  decryptPendingRecord,
  loadInstagramPendingRecord,
} from '../instagram-pending-connect'
import {
  interpretWhatsAppOwnershipGraphData,
  isMetaNonexistingFieldError,
  verifyWhatsAppAssetsForToken,
  WHATSAPP_OWNERSHIP_PHONE_FIELDS,
} from '../meta-api'

test('ig pending cookie JWT never embeds pageAccessToken (SD-01)', async () => {
  const previous = process.env.NEXTAUTH_SECRET
  process.env.NEXTAUTH_SECRET = 'test-secret-for-ig-pending-sd01'

  const { cookieToken, pendingId, publicMatches } = await createInstagramPendingConnect({
    tenantId: 'tenant-a',
    userId: 'user-a',
    matches: [
      {
        pageId: 'page-1',
        pageName: 'Page One',
        pageAccessToken: 'EAA_RAW_PAGE_TOKEN_MUST_NOT_APPEAR',
        igBusinessAccountId: 'ig-1',
        igUsername: 'demo',
      },
      {
        pageId: 'page-2',
        pageName: 'Page Two',
        pageAccessToken: 'EAA_ANOTHER_SECRET_TOKEN',
        igBusinessAccountId: 'ig-2',
        igUsername: null,
      },
    ],
  })

  const claims = await decodeInstagramPendingCookieClaimsForTest(cookieToken)
  assert.ok(claims)
  assert.equal(claims.pendingId, pendingId)
  assert.equal(claims.tenantId, 'tenant-a')
  assert.equal(claims.userId, 'user-a')
  assert.deepEqual(claims.pageIds, ['page-1', 'page-2'])
  assert.equal('matches' in claims, false)
  assert.equal('pageAccessToken' in claims, false)

  const serialized = JSON.stringify(claims)
  assert.equal(serialized.includes('EAA_RAW_PAGE_TOKEN_MUST_NOT_APPEAR'), false)
  assert.equal(serialized.includes('pageAccessToken'), false)
  assert.equal(serialized.includes('EAA_ANOTHER_SECRET_TOKEN'), false)

  assert.equal(publicMatches[0].pageId, 'page-1')
  assert.equal('pageAccessToken' in publicMatches[0], false)

  const loaded = await loadInstagramPendingRecord(cookieToken, {
    tenantId: 'tenant-a',
    userId: 'user-a',
  })
  assert.ok(loaded)
  assert.equal(loaded.record.matches[0].pageAccessToken, 'EAA_RAW_PAGE_TOKEN_MUST_NOT_APPEAR')

  const wrongSession = await loadInstagramPendingRecord(cookieToken, {
    tenantId: 'tenant-b',
    userId: 'user-a',
  })
  assert.equal(wrongSession, null)

  if (previous === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = previous
})

test('pending record encrypt/decrypt roundtrip keeps tokens server-side only', () => {
  const previous = process.env.NEXTAUTH_SECRET
  process.env.NEXTAUTH_SECRET = 'test-secret-for-ig-pending-sd01'
  const ciphertext = encryptPendingRecord({
    tenantId: 't1',
    userId: 'u1',
    createdAt: Date.now(),
    matches: [
      {
        pageId: 'p1',
        pageName: 'P',
        pageAccessToken: 'SECRET_TOKEN_VALUE',
        igBusinessAccountId: 'ig1',
      },
    ],
  })
  assert.equal(ciphertext.includes('SECRET_TOKEN_VALUE'), false)
  const decoded = decryptPendingRecord(ciphertext)
  assert.equal(decoded?.matches[0].pageAccessToken, 'SECRET_TOKEN_VALUE')
  if (previous === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = previous
})

test('WA ownership interpreter rejects mismatched phone/WABA before upsert (SD-02)', () => {
  const ok = interpretWhatsAppOwnershipGraphData({
    graphOk: true,
    claimedPhoneNumberId: '111',
    claimedWabaId: 'waba-a',
    data: {
      id: '111',
      whatsapp_business_account: { id: 'waba-a' },
    },
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.phoneNumberId, '111')
  assert.equal(ok.whatsappBusinessAccountId, 'waba-a')

  const badPhone = interpretWhatsAppOwnershipGraphData({
    graphOk: true,
    claimedPhoneNumberId: '111',
    data: { id: '999', whatsapp_business_account: { id: 'waba-a' } },
  })
  assert.equal(badPhone.ok, false)
  assert.equal(badPhone.reason, 'phone_id_mismatch')

  const badWaba = interpretWhatsAppOwnershipGraphData({
    graphOk: true,
    claimedPhoneNumberId: '111',
    claimedWabaId: 'waba-attacker',
    data: { id: '111', whatsapp_business_account: { id: 'waba-real' } },
  })
  assert.equal(badWaba.ok, false)
  assert.equal(badWaba.reason, 'waba_mismatch')

  const graphDenied = interpretWhatsAppOwnershipGraphData({
    graphOk: false,
    claimedPhoneNumberId: '111',
    data: { error: { message: 'unsupported get request' } },
  })
  assert.equal(graphDenied.ok, false)
  assert.match(String(graphDenied.reason), /unsupported get request/)
})

test('WA ownership interpreter tolerates missing nested WABA field (coexistence)', () => {
  const phoneOnly = interpretWhatsAppOwnershipGraphData({
    graphOk: true,
    claimedPhoneNumberId: '111',
    claimedWabaId: 'waba-coexist',
    data: { id: '111', display_phone_number: '+506…', verified_name: 'Store' },
  })
  assert.equal(phoneOnly.ok, true)
  assert.equal(phoneOnly.phoneNumberId, '111')
  assert.equal(phoneOnly.whatsappBusinessAccountId, null)
  assert.equal(phoneOnly.providerDisplayName, 'Store')
  assert.equal(phoneOnly.displayPhoneNumber, '+506…')

  const nestedFieldMissing = interpretWhatsAppOwnershipGraphData({
    graphOk: false,
    claimedPhoneNumberId: '111',
    claimedWabaId: 'waba-coexist',
    data: {
      error: {
        code: 100,
        message: '(#100) Tried accessing nonexisting field (whatsapp_business_account)',
      },
    },
  })
  assert.equal(nestedFieldMissing.ok, false)
  assert.equal(nestedFieldMissing.reason, 'nonexisting_waba_field')
  assert.equal(
    isMetaNonexistingFieldError(
      {
        error: {
          code: 100,
          message: '(#100) Tried accessing nonexisting field (whatsapp_business_account)',
        },
      },
      'whatsapp_business_account',
    ),
    true,
  )
})

test('verifyWhatsAppAssetsForToken: claimed WABA + safe phone GET succeeds (Forge coexistence)', async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requestedUrls.push(url)

    if (url.includes('/phone_numbers')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'phone-coexist-1',
              display_phone_number: '+506 8888 0000',
              is_on_biz_app: true,
              platform_type: 'CLOUD_API',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Phone node GET — must use safe fields only (no nested whatsapp_business_account).
    assert.match(url, /phone-coexist-1/)
    assert.equal(decodeURIComponent(url).includes(WHATSAPP_OWNERSHIP_PHONE_FIELDS), true)
    assert.equal(url.includes('whatsapp_business_account'), false)

    return new Response(
      JSON.stringify({
        id: 'phone-coexist-1',
        display_phone_number: '+506 8888 0000',
        verified_name: 'Forge Store',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const ownership = await verifyWhatsAppAssetsForToken({
      accessToken: 'EAA_TEST_TOKEN',
      phoneNumberId: 'phone-coexist-1',
      whatsappBusinessAccountId: 'waba-coexist-9',
    })
    assert.equal(ownership.ok, true)
    assert.equal(ownership.phoneNumberId, 'phone-coexist-1')
    assert.equal(ownership.whatsappBusinessAccountId, 'waba-coexist-9')
    assert.equal(
      requestedUrls.some((u) => u.includes('whatsapp_business_account')),
      false,
      'claimed-WABA verify must never request nested whatsapp_business_account',
    )
    assert.equal(requestedUrls.some((u) => u.includes('/phone_numbers')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('verifyWhatsAppAssetsForToken: phone on wrong WABA list → waba_mismatch', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/phone_numbers')) {
      return new Response(
        JSON.stringify({
          data: [{ id: 'other-phone', display_phone_number: '+1' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ id: 'phone-1', verified_name: 'X' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const ownership = await verifyWhatsAppAssetsForToken({
      accessToken: 'tok',
      phoneNumberId: 'phone-1',
      whatsappBusinessAccountId: 'waba-x',
    })
    assert.equal(ownership.ok, false)
    assert.equal(ownership.reason, 'waba_mismatch')
    assert.equal(ownership.phoneNumberId, 'phone-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('verifyWhatsAppAssetsForToken: no claimed WABA + nested #100 still owns phone', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    // resolveWhatsAppBusinessAccountId may still probe nested field — return #100.
    if (url.includes('whatsapp_business_account') && !url.includes('{')) {
      return new Response(
        JSON.stringify({
          error: {
            code: 100,
            message: '(#100) Tried accessing nonexisting field (whatsapp_business_account)',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ id: 'phone-solo', verified_name: 'Solo' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const ownership = await verifyWhatsAppAssetsForToken({
      accessToken: 'tok',
      phoneNumberId: 'phone-solo',
    })
    assert.equal(ownership.ok, true)
    assert.equal(ownership.phoneNumberId, 'phone-solo')
    assert.equal(ownership.whatsappBusinessAccountId, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('WA exchange route Graph-verifies ownership and drops tokenPrefix logs (SD-02/03)', async () => {
  const source = await readFile('src/app/api/auth/whatsapp/exchange/route.ts', 'utf8')
  assert.match(source, /verifyWhatsAppAssetsForToken/)
  assert.match(source, /ownership\.ok/)
  assert.doesNotMatch(source, /tokenPrefix/)
  assert.match(source, /status: 403/)
  // Soft-fail subscribe is gone: failures must be loud (422) and isActive follows subscribeOk.
  assert.match(source, /subscribe_failed/)
  assert.match(source, /status: 422/)
  assert.match(source, /isActive: subscribeOk/)
  assert.match(source, /subscribed: true/)
  // Dedicated CRM WA Meta app helpers (fallback to META_APP_*).
  assert.match(source, /getMetaWhatsAppAppId/)
  assert.match(source, /getMetaWhatsAppAppSecret/)
})

test('WA manual link Graph-verifies ownership like exchange and fails loud on subscribe', async () => {
  const source = await readFile('src/app/api/social/link/route.ts', 'utf8')
  assert.match(source, /verifyWhatsAppAssetsForToken/)
  assert.match(source, /ownership\.ok/)
  assert.match(source, /status: 403/)
  assert.match(source, /subscribe_failed/)
  assert.match(source, /status: 422/)
  assert.match(source, /isActive: subscribeOk/)
  assert.match(source, /subscribed: true/)
})

test('IG auth-url requires update_config (Phase 5 RBAC)', async () => {
  const source = await readFile('src/app/api/auth/instagram/auth-url/route.ts', 'utf8')
  assert.match(source, /authenticateAPIWithPermission/)
  assert.match(source, /update_config/)
  assert.doesNotMatch(source, /getToken/)
})

test('meta-api ownership verify never hard-codes nested whatsapp_business_account in verify fields', async () => {
  const source = await readFile('src/lib/meta-api.ts', 'utf8')
  assert.match(source, /WHATSAPP_OWNERSHIP_PHONE_FIELDS/)
  assert.match(source, /listWhatsAppPhoneNumbersForWaba/)
  assert.match(source, /isMetaNonexistingFieldError/)
  // Safe constant must not include the nested edge.
  assert.doesNotMatch(
    source.match(/WHATSAPP_OWNERSHIP_PHONE_FIELDS\s*=\s*'([^']+)'/)?.[1] || '',
    /whatsapp_business_account/,
  )
})


test('IG callback OAuth code exchange uses META_WA_APP_SECRET, never META_APP_SECRET (client secret must match META_APP_ID app)', async () => {
  const source = await readFile('src/app/api/auth/instagram/callback/route.ts', 'utf8')

  // Isolate the code->token exchange block (between the appId/appSecret env reads and
  // the fetch(tokenUrl) call) so the later debug_token block — which legitimately
  // falls back to META_APP_SECRET — doesn't make this assertion pass by accident.
  const exchangeStart = source.indexOf('const appId = process.env.META_APP_ID')
  const exchangeEnd = source.indexOf('fetch(tokenUrl)')
  assert.ok(exchangeStart > -1 && exchangeEnd > exchangeStart, 'could not locate OAuth exchange block')
  const exchangeBlock = source.slice(exchangeStart, exchangeEnd)

  assert.match(exchangeBlock, /process\.env\.META_WA_APP_SECRET/)
  assert.doesNotMatch(exchangeBlock, /process\.env\.META_APP_SECRET\b/)
  assert.match(exchangeBlock, /client_secret:\s*appSecret/)
  assert.match(exchangeBlock, /process\.env\.META_APP_ID/)

  // The config-error copy must name the env vars this route actually checks.
  assert.match(source, /META_APP_ID o META_WA_APP_SECRET/)
})

test('WA direct-oauth requires update_config and persists CSRF state cookie (SD-04)', async () => {
  const source = await readFile('src/app/api/auth/whatsapp/direct-oauth/route.ts', 'utf8')
  assert.match(source, /authenticateAPIWithPermission/)
  assert.match(source, /update_config/)
  assert.match(source, /WA_DIRECT_OAUTH_STATE_COOKIE|wa_direct_oauth_state/)
  assert.match(source, /cookies\.set/)
  assert.match(source, /buildWhatsAppDirectOauthDialogUrl/)
  assert.match(source, /NEXT_PUBLIC_FB_LOGIN_CONFIG_ID/)
  assert.doesNotMatch(source, /console\.log\([^)]*state[^)]*\)/)

  const callback = await readFile('src/app/api/auth/whatsapp/callback/route.ts', 'utf8')
  assert.match(callback, /isValidWaDirectOauthState/)
  assert.match(callback, /status: 403/)
  assert.match(callback, /type: 'wa_direct_oauth'/)

  const { isValidWaDirectOauthState } = await import('../wa-direct-oauth-state')
  assert.equal(isValidWaDirectOauthState('abc', 'abc'), true)
  assert.equal(isValidWaDirectOauthState('abc', 'xyz'), false)
  assert.equal(isValidWaDirectOauthState('', 'abc'), false)
})


test('WA exchange returns accessToken on waitingForPhoneNumber (ES code handoff)', async () => {
  const source = await readFile('src/app/api/auth/whatsapp/exchange/route.ts', 'utf8')
  assert.match(source, /waitingForPhoneNumber:\s*true/)
  assert.match(source, /accessToken:\s*businessToken/)
  assert.match(source, /Using existing SocialAccount phone for WABA reconnect/)
})

test('Embedded Signup single-use code is only spent once FINISH assets exist', async () => {
  const { waSignupReadyToExchange } = await import('../whatsapp-embedded-signup')
  // No credential, or credential without FINISH phone/WABA assets: never exchange.
  assert.equal(waSignupReadyToExchange({}), false)
  assert.equal(waSignupReadyToExchange({ code: 'c1' }), false)
  assert.equal(waSignupReadyToExchange({ code: 'c1', message: { data: {} } } as never), false)
  // FINISH with a phone number id, or only a WABA id (coexistence): ready.
  assert.equal(waSignupReadyToExchange({ code: 'c1', message: { data: { phone_number_id: '123', waba_id: '9' } } } as never), true)
  assert.equal(waSignupReadyToExchange({ accessToken: 't', message: { data: { waba_id: '9' } } } as never), true)
})

test('social page retries Embedded Signup exchange after in-flight FINISH race', async () => {
  // CRLF-safe: the checkout may use Windows line endings.
  const source = (await readFile('src/app/config/social/page.tsx', 'utf8')).replace(/\r\n/g, '\n')
  // FINISH arriving mid-exchange is remembered instead of starting a second exchange…
  assert.match(source, /if \(pending\.exchanging\) \{[\s\S]{0,300}pending\.retryAfter = true\s*\n\s*return/)
  // …the code is never spent before FINISH assets exist…
  assert.match(source, /if \(!waSignupReadyToExchange\(pending\)\) return/)
  // …a burned code's business token is kept for the later FINISH…
  assert.match(source, /pending\.accessToken = exchangeData\.accessToken\s*\n\s*pending\.code = null/)
  // …and once the in-flight call ends, it retries exactly when FINISH came in and is ready.
  assert.match(source, /const canRetry = Boolean\(again\.retryAfter\) && waSignupReadyToExchange\(again\)/)
  assert.match(source, /if \(canRetry\) \{\s*\n\s*void tryExchangeWhatsAppSignupRef\.current\(\)/)
  // Never burns the code on a fixed timer without waiting for FINISH.
  assert.doesNotMatch(source, /setTimeout\(r, \d+\)/)
})

test('default appsecret_proof signs with the Inbox secret (META_WA_APP_SECRET), not the Staff META_APP_SECRET', async () => {
  const { generateAppSecretProof } = await import('../meta-api')
  const { createHmac } = await import('node:crypto')
  const keys = ['META_WA_APP_SECRET', 'INSTAGRAM_APP_SECRET', 'META_APP_SECRET'] as const
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    process.env.META_WA_APP_SECRET = 'inbox-app-secret-0123456789'
    process.env.META_APP_SECRET = 'staff-app-secret-0123456789'
    delete process.env.INSTAGRAM_APP_SECRET
    const expected = createHmac('sha256', 'inbox-app-secret-0123456789').update('tok').digest('hex')
    assert.equal(generateAppSecretProof('tok'), expected)
    assert.equal(generateAppSecretProof('tok', { purpose: 'whatsapp' }), expected)

    // Single-app dev setups (no Inbox secret) still sign with META_APP_SECRET.
    delete process.env.META_WA_APP_SECRET
    const staff = createHmac('sha256', 'staff-app-secret-0123456789').update('tok').digest('hex')
    assert.equal(generateAppSecretProof('tok'), staff)
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
})

test('listFacebookPages falls back to the Page granted on debug_token granular_scopes', async () => {
  const { listFacebookPages } = await import('../instagram-connect')
  const realFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (url.includes('/me/accounts')) return json({ data: [] })
    if (url.includes('/me/businesses')) return json({ data: [] })
    if (url.includes('/debug_token')) {
      return json({
        data: {
          granular_scopes: [
            { scope: 'pages_show_list', target_ids: ['1088769440981400'] },
            { scope: 'instagram_basic', target_ids: ['17841477784563392'] },
          ],
        },
      })
    }
    if (url.includes('/1088769440981400?')) {
      return json({
        id: '1088769440981400',
        name: 'Betsycrm',
        access_token: 'page-token',
        instagram_business_account: { id: '17841477784563392', username: 'betsy_crm' },
      })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  try {
    const result = await listFacebookPages('user-token', { appAccessToken: 'app|secret' })
    assert.equal(result.source, 'granular_scopes')
    assert.equal(result.pages.length, 1)
    assert.equal(result.pages[0].id, '1088769440981400')
    assert.equal(result.pages[0].instagramBusinessAccount?.id, '17841477784563392')
    // IG business account ids from instagram_basic are not fetched as Pages.
    assert.ok(!calls.some((u) => u.includes('/17841477784563392?')))

    const without = await listFacebookPages('user-token')
    assert.equal(without.source, 'none')
  } finally {
    globalThis.fetch = realFetch
  }
})
