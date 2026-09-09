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
import { interpretWhatsAppOwnershipGraphData } from '../meta-api'

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

test('WA exchange route Graph-verifies ownership and drops tokenPrefix logs (SD-02/03)', async () => {
  const source = await readFile('src/app/api/auth/whatsapp/exchange/route.ts', 'utf8')
  assert.match(source, /verifyWhatsAppAssetsForToken/)
  assert.match(source, /ownership\.ok/)
  assert.doesNotMatch(source, /tokenPrefix/)
  assert.match(source, /status: 403/)
})

test('IG auth-url requires session (SD-04)', async () => {
  const source = await readFile('src/app/api/auth/instagram/auth-url/route.ts', 'utf8')
  assert.match(source, /getToken/)
  assert.match(source, /Unauthorized/)
  assert.match(source, /status: 401/)
})
