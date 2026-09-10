/**
 * Tenant-safe SocialAccount resolution for Meta chat webhooks.
 * Never uses ambiguous findFirst across tenants — multi-match refuses binding.
 */
import type { ParsedMetaChatMessage } from '@/lib/meta-chat'
import {
  encodeInstagramRefreshToken,
  getPageIdFromMetaChatMetadata,
} from '@/lib/social-account-meta'

export type WebhookSocialAccountRow = {
  id: string
  tenantId: string
  refreshToken?: string | null
}

export type ResolveAccountResult =
  | { ok: true; account: WebhookSocialAccountRow }
  | { ok: false; reason: 'account_not_found' | 'ambiguous_tenant_match' }

type SocialAccountDb = {
  socialAccount: {
    findMany: (args: unknown) => Promise<WebhookSocialAccountRow[]>
  }
}

/**
 * Resolve exactly one active SocialAccount for a parsed Meta event.
 * - Unique (platform, accountId) among active rows → bind that tenant.
 * - Multiple active rows (same Meta asset, different tenants) → refuse.
 * - IG page fallback: match encoded `page:<pageId>` refreshToken only;
 *   never scan all Instagram accounts globally.
 */
export async function resolveWebhookSocialAccount(
  db: SocialAccountDb,
  event: ParsedMetaChatMessage,
): Promise<ResolveAccountResult> {
  const byAccountId = await db.socialAccount.findMany({
    where: {
      platform: event.platform,
      accountId: event.accountId,
      isActive: true,
    },
    select: { id: true, tenantId: true, refreshToken: true },
  })

  if (byAccountId.length === 1) {
    return { ok: true, account: byAccountId[0]! }
  }
  if (byAccountId.length > 1) {
    const tenantIds = [...new Set(byAccountId.map((row) => row.tenantId))]
    console.warn('[chat/webhook] Ambiguous SocialAccount match — refusing cross-tenant bind', {
      platform: event.platform,
      accountId: event.accountId,
      matchCount: byAccountId.length,
      tenantIds,
    })
    return { ok: false, reason: 'ambiguous_tenant_match' }
  }

  if (event.platform !== 'instagram') {
    return { ok: false, reason: 'account_not_found' }
  }

  const pageId = getPageIdFromMetaChatMetadata(event.metadata)
  if (!pageId) {
    return { ok: false, reason: 'account_not_found' }
  }

  const encodedPage = encodeInstagramRefreshToken(pageId)
  if (!encodedPage) {
    return { ok: false, reason: 'account_not_found' }
  }

  const byPage = await db.socialAccount.findMany({
    where: {
      platform: 'instagram',
      isActive: true,
      refreshToken: encodedPage,
    },
    select: { id: true, tenantId: true, refreshToken: true },
  })

  if (byPage.length === 1) {
    return { ok: true, account: byPage[0]! }
  }
  if (byPage.length > 1) {
    const tenantIds = [...new Set(byPage.map((row) => row.tenantId))]
    console.warn('[chat/webhook] Ambiguous IG page match — refusing cross-tenant bind', {
      platform: 'instagram',
      pageId,
      matchCount: byPage.length,
      tenantIds,
    })
    return { ok: false, reason: 'ambiguous_tenant_match' }
  }

  return { ok: false, reason: 'account_not_found' }
}
