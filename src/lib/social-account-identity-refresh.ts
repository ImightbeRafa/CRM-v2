import { prisma } from '@/lib/db'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import {
  fetchInstagramPageIdentity,
  verifyWhatsAppAssetsForToken,
} from '@/lib/meta-api'
import {
  identityPersistPayload,
  needsIdentityRefresh,
} from '@/lib/social-account-identity'

const IDENTITY_REFRESH_THROTTLE_MS = 60 * 60 * 1000

type IdentityAccountRow = {
  id: string
  platform: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  displayName: string | null
  providerDisplayName: string | null
  providerUsername: string | null
  displayPhoneNumber: string | null
  wabaId: string | null
  pageId: string | null
  tokenLastCheckedAt: Date | null
}

/**
 * Atomically claim a ≤1/h refresh slot via tokenLastCheckedAt.
 * Returns true when this caller owns the refresh attempt.
 */
export async function claimIdentityRefreshSlot(
  accountId: string,
  now = new Date(),
): Promise<boolean> {
  const db = prisma as any
  const cutoff = new Date(now.getTime() - IDENTITY_REFRESH_THROTTLE_MS)
  const result = await db.socialAccount.updateMany({
    where: {
      id: accountId,
      OR: [{ tokenLastCheckedAt: null }, { tokenLastCheckedAt: { lt: cutoff } }],
    },
    data: { tokenLastCheckedAt: now },
  })
  return (result?.count ?? 0) > 0
}

async function refreshWhatsAppIdentity(row: IdentityAccountRow): Promise<boolean> {
  const token = decryptSocialAccessToken(row.accessToken)
  if (!token) return false
  const meta = parseSocialRefreshToken(row.refreshToken)
  const wabaId = row.wabaId || meta.whatsappBusinessAccountId
  const verified = await verifyWhatsAppAssetsForToken({
    accessToken: token,
    phoneNumberId: row.accountId,
    whatsappBusinessAccountId: wabaId,
  })
  if (!verified.ok) return false

  const identity = identityPersistPayload({
    platform: 'whatsapp',
    providerDisplayName: verified.providerDisplayName,
    displayPhoneNumber: verified.displayPhoneNumber,
    wabaId: verified.whatsappBusinessAccountId || wabaId,
    existingDisplayName: row.displayName,
  })

  const db = prisma as any
  await db.socialAccount.update({
    where: { id: row.id },
    data: {
      providerDisplayName: identity.providerDisplayName,
      displayPhoneNumber: identity.displayPhoneNumber,
      wabaId: identity.wabaId,
      displayName: identity.displayName,
    },
  })
  return true
}

async function refreshInstagramIdentity(row: IdentityAccountRow): Promise<boolean> {
  const token = decryptSocialAccessToken(row.accessToken)
  if (!token) return false
  const meta = parseSocialRefreshToken(row.refreshToken)
  const pageId = row.pageId || meta.pageId
  if (!pageId) return false

  const fetched = await fetchInstagramPageIdentity({ pageId, accessToken: token })
  if (!fetched.ok) return false

  const identity = identityPersistPayload({
    platform: 'instagram',
    providerDisplayName: fetched.pageName,
    providerUsername: fetched.igUsername,
    pageId,
    existingDisplayName: row.displayName,
  })

  const db = prisma as any
  await db.socialAccount.update({
    where: { id: row.id },
    data: {
      providerDisplayName: identity.providerDisplayName,
      providerUsername: identity.providerUsername,
      pageId: identity.pageId,
      displayName: identity.displayName,
    },
  })
  return true
}

/**
 * Lazy Graph identity backfill for accounts missing provider fields.
 * Throttled ≤1/h/account via atomic tokenLastCheckedAt claim.
 */
export async function refreshMissingAccountIdentities(
  rows: IdentityAccountRow[],
): Promise<{ attempted: number; refreshed: number }> {
  let attempted = 0
  let refreshed = 0

  for (const row of rows) {
    if (!needsIdentityRefresh(row)) continue
    const claimed = await claimIdentityRefreshSlot(row.id)
    if (!claimed) continue
    attempted += 1
    try {
      const ok =
        row.platform === 'whatsapp'
          ? await refreshWhatsAppIdentity(row)
          : row.platform === 'instagram'
            ? await refreshInstagramIdentity(row)
            : false
      if (ok) refreshed += 1
    } catch (error) {
      console.warn('[social-account-identity-refresh] failed', {
        accountId: row.id,
        platform: row.platform,
        error,
      })
    }
  }

  return { attempted, refreshed }
}

export const IDENTITY_REFRESH_THROTTLE_MS_FOR_TESTS = IDENTITY_REFRESH_THROTTLE_MS
