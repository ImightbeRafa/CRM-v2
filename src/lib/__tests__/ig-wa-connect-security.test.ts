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

test('IG auth-url requires session (SD-04)', async () => {
  const source = await readFile('src/app/api/auth/instagram/auth-url/route.ts', 'utf8')
  assert.match(source, /getToken/)
  assert.match(source, /Unauthorized/)
  assert.match(source, /status: 401/)
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
