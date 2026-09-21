import { prisma } from '@/lib/db'
import { encryptSocialAccessToken } from '@/lib/social-account-crypto'
import { encodeInstagramRefreshToken } from '@/lib/social-account-meta'
import { identityPersistPayload } from '@/lib/social-account-identity'

export type UpsertInstagramSocialAccountParams = {
  tenantId: string
  userId: string
  igBusinessAccountId: string
  pageAccessToken: string
  pageId: string
  pageName?: string | null
  igUsername?: string | null
  /** When false, still persist token but mark inactive (subscribe failed). Default true. */
  isActive?: boolean
}

/**
 * Shared IG SocialAccount upsert used by callback + complete routes.
 * Persists provider identity columns and default displayName (§7.2).
 */
export async function upsertInstagramSocialAccount(params: UpsertInstagramSocialAccountParams) {
  const db = prisma as any
  const expiresAt = new Date(Date.now() + 5184000 * 1000)
  const refreshToken = encodeInstagramRefreshToken(params.pageId)
  const existing = await db.socialAccount.findFirst({
    where: {
      tenantId: params.tenantId,
      platform: 'instagram',
      accountId: String(params.igBusinessAccountId),
    },
    select: {
      id: true,
      displayName: true,
    },
  })

  const identity = identityPersistPayload({
    platform: 'instagram',
    providerDisplayName: params.pageName,
    providerUsername: params.igUsername,
    pageId: params.pageId,
    existingDisplayName: existing?.displayName,
  })

  const encryptedToken = encryptSocialAccessToken(params.pageAccessToken)
  const isActive = params.isActive !== false
  const data = {
    accessToken: encryptedToken,
    refreshToken: refreshToken ?? undefined,
    expiresAt,
    isActive,
    userId: params.userId,
    providerDisplayName: identity.providerDisplayName,
    providerUsername: identity.providerUsername,
    pageId: identity.pageId,
    displayName: identity.displayName,
  }

  if (existing) {
    return db.socialAccount.update({
      where: { id: existing.id },
      data,
    })
  }

  return db.socialAccount.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      platform: 'instagram',
      accountId: String(params.igBusinessAccountId),
      ...data,
    },
  })
}
