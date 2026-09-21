/**
 * Respond.io Phase 5 — self-serve Meta connect, soft-unlink, token health.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'
import { canAccessRoute, hasPermission, type Role } from '../rbac'
import {
  accountNeedsReconnect,
  classifyTokenStatus,
  expiresAtFromExpiresIn,
  expiresAtFromMetaDebug,
  reconnectLifecycleData,
  softUnlinkUpdateData,
  socialReconnectBannerLabel,
  socialTokenSendBlockMessage,
} from '../social-account-token-health'

const root = resolve(process.cwd())
function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Phase 5 — server RBAC for social connect', () => {
  it('OWNER and ADMIN have update_config; MANAGER/SALES do not', () => {
    assert.equal(hasPermission('OWNER', 'update_config'), true)
    assert.equal(hasPermission('ADMIN', 'update_config'), true)
    for (const role of ['MANAGER', 'SALES', 'PRODUCTION', 'VIEWER'] as Role[]) {
      assert.equal(hasPermission(role, 'update_config'), false)
    }
  })

  it('/config/social requires update_config via route map', () => {
    assert.equal(canAccessRoute('OWNER', '/config/social'), true)
    assert.equal(canAccessRoute('ADMIN', '/config/social'), true)
    assert.equal(canAccessRoute('MANAGER', '/config/social'), false)
    assert.equal(canAccessRoute('SALES', '/config/social'), false)
  })

  it('social layout server-gates with requirePermission(update_config)', () => {
    const src = read('src/app/config/social/layout.tsx')
    assert.match(src, /requirePermission\(['"]update_config['"]\)/)
  })

  it('WA exchange + IG connect routes require update_config', () => {
    const files = [
      'src/app/api/auth/whatsapp/exchange/route.ts',
      'src/app/api/auth/whatsapp/direct-oauth/route.ts',
      'src/app/api/auth/instagram/auth-url/route.ts',
      'src/app/api/auth/instagram/callback/route.ts',
      'src/app/api/auth/instagram/complete/route.ts',
      'src/app/api/auth/instagram/cancel/route.ts',
    ]
    for (const file of files) {
      const src = read(file)
      assert.match(src, /authenticateAPIWithPermission/, `${file} auth helper`)
      assert.match(src, /update_config/, `${file} permission`)
    }
  })
})

describe('Phase 5 — IG subscribe truth', () => {
  it('IG upsert accepts isActive and real expiresAt (no hardcoded +60d)', () => {
    const src = read('src/lib/instagram-social-account.ts')
    assert.doesNotMatch(src, /5184000/)
    assert.match(src, /isActive/)
    assert.match(src, /expiresAt/)
    assert.match(src, /reconnectLifecycleData/)
  })

  it('IG callback/complete pass isActive from subscribeOk', () => {
    for (const file of [
      'src/app/api/auth/instagram/callback/route.ts',
      'src/app/api/auth/instagram/complete/route.ts',
    ]) {
      const src = read(file)
      assert.match(src, /subscribeOk/, file)
      assert.match(src, /isActive:\s*subscribeOk/, file)
      assert.match(src, /Re-suscrib|re-suscrib|sin webhooks/i, file)
    }
  })
})

describe('Phase 5 — token lifecycle helpers', () => {
  it('expiresAtFromExpiresIn uses provider TTL', () => {
    const at = expiresAtFromExpiresIn(3600, Date.parse('2026-09-21T00:00:00.000Z'))
    assert.ok(at)
    assert.equal(at!.toISOString(), '2026-09-21T01:00:00.000Z')
    assert.equal(expiresAtFromExpiresIn(0), null)
    assert.equal(expiresAtFromExpiresIn(undefined), null)
  })

  it('expiresAtFromMetaDebug treats 0 as non-expiring', () => {
    assert.equal(expiresAtFromMetaDebug({ expires_at: 0, data_access_expires_at: 0 }), null)
    const at = expiresAtFromMetaDebug({ expires_at: 1_700_000_000 })
    assert.ok(at)
  })

  it('classifyTokenStatus maps Graph 190 to revoked and near-expiry to expiring', () => {
    assert.equal(
      classifyTokenStatus({ graphOk: false, graphErrorCode: 190, graphHttpStatus: 400 }),
      'revoked',
    )
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    assert.equal(classifyTokenStatus({ graphOk: true, expiresAt: soon }), 'expiring')
    const past = new Date(Date.now() - 60_000)
    assert.equal(classifyTokenStatus({ graphOk: true, expiresAt: past }), 'expired')
    assert.equal(classifyTokenStatus({ graphOk: true }), 'valid')
  })

  it('Spanish send block copy for revoked/disconnected', () => {
    const revoked = socialTokenSendBlockMessage({
      platform: 'instagram',
      tokenStatus: 'revoked',
      isActive: true,
    })
    assert.match(revoked, /revocado/i)
    assert.match(revoked, /Instagram/)
    const unlinked = socialTokenSendBlockMessage({
      platform: 'whatsapp',
      isActive: false,
      disconnectedAt: new Date(),
    })
    assert.match(unlinked, /desvinculad/i)
  })

  it('reconnect banner labels include shop handle / channel name', () => {
    assert.equal(
      socialReconnectBannerLabel({
        id: '1',
        platform: 'instagram',
        accountId: '99',
        providerUsername: 'shop',
        tokenStatus: 'revoked',
      }),
      'Reconectar Instagram · @shop',
    )
    assert.equal(
      socialReconnectBannerLabel({
        id: '2',
        platform: 'whatsapp',
        accountId: '55',
        displayName: 'Forge',
        tokenStatus: 'expired',
      }),
      'Reconectar WhatsApp · Forge',
    )
    assert.equal(
      accountNeedsReconnect({
        id: '1',
        platform: 'instagram',
        accountId: 'x',
        tokenStatus: 'revoked',
      }),
      true,
    )
  })

  it('WA exchange persists expiresAt via expiresAtFromExpiresIn', () => {
    const src = read('src/app/api/auth/whatsapp/exchange/route.ts')
    assert.match(src, /expiresAtFromExpiresIn/)
    assert.match(src, /tokenExpiresIn/)
    assert.match(src, /authenticateAPIWithPermission/)
  })

  it('daily chat-token-health cron exists and auth uses CRON_SECRET', () => {
    const src = read('src/app/api/cron/chat-token-health/route.ts')
    assert.match(src, /CRON_SECRET/)
    assert.match(src, /probeSocialAccountToken/)
    assert.match(src, /tokenStatus/)
    const vercel = read('vercel.json')
    assert.match(vercel, /\/api\/cron\/chat-token-health/)
  })
})

describe('Phase 5 — soft unlink + reconnect same id', () => {
  it('unlink soft-deactivates and never DELETE FROM SocialAccount', () => {
    const src = read('src/app/api/social/unlink/route.ts')
    assert.match(src, /softUnlinkUpdateData/)
    assert.doesNotMatch(src, /DELETE FROM ["']SocialAccount["']/)
    assert.match(src, /softUnlinked:\s*true/)
  })

  it('softUnlinkUpdateData clears tokens and sets disconnectedAt', () => {
    const data = softUnlinkUpdateData(new Date('2026-09-21T12:00:00.000Z'))
    assert.equal(data.isActive, false)
    assert.equal(data.accessToken, null)
    assert.equal(data.refreshToken, null)
    assert.equal(data.tokenStatus, 'unknown')
    assert.equal(data.disconnectedAt.toISOString(), '2026-09-21T12:00:00.000Z')
  })

  it('reconnectLifecycleData clears disconnectedAt and sets tokenStatus', () => {
    const data = reconnectLifecycleData({
      isActive: true,
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      now: new Date('2026-09-21T12:00:00.000Z'),
    })
    assert.equal(data.disconnectedAt, null)
    assert.equal(data.isActive, true)
    assert.equal(data.tokenStatus, 'valid')
    assert.ok(data.expiresAt)
  })

  it('IG upsert reuses existing row id (findFirst then update)', () => {
    const src = read('src/lib/instagram-social-account.ts')
    assert.match(src, /findFirst/)
    assert.match(src, /\.update\(/)
    assert.match(src, /existing\.id/)
  })
})
