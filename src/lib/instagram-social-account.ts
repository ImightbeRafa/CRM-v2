import { prisma } from '@/lib/db'
import { encryptSocialAccessToken } from '@/lib/social-account-crypto'
import { encodeInstagramRefreshToken } from '@/lib/social-account-meta'
import { identityPersistPayload } from '@/lib/social-account-identity'
import { reconnectLifecycleData } from '@/lib/social-account-token-health'

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
  /** Real Meta TTL; null = non-expiring. When omitted, keep existing expiresAt on update. */
  expiresAt?: Date | null
}

/**
 * Shared IG SocialAccount upsert used by callback + complete routes.
 * Persists provider identity and default displayName (§7.2).
 * Reconnect of the same IG asset reuses the same row id (history preserved).
 */
export async function upsertInstagramSocialAccount(params: UpsertInstagramSocialAccountParams) {
  const db = prisma as any
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
      expiresAt: true,
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
  const expiresAt =
    params.expiresAt !== undefined ? params.expiresAt : (existing?.expiresAt ?? null)

  const lifecycle = reconnectLifecycleData({ isActive, expiresAt })
  const data = {
    accessToken: encryptedToken,
    refreshToken: refreshToken ?? undefined,
    userId: params.userId,
    providerDisplayName: identity.providerDisplayName,
    providerUsername: identity.providerUsername,
    pageId: identity.pageId,
    displayName: identity.displayName,
    ...lifecycle,
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
      platform: 'instagram',
      accountId: String(params.igBusinessAccountId),
      ...data,
    },
  })
}
