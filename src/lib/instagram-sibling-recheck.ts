/**
 * Dead-line alarm — after an Instagram connect, re-check the business's OTHER Instagram lines.
 * Facebook Login's page picker drops every page that was not ticked in the new login, so connecting
 * @a can silently cut @b (2026-10-18: @prototipo.cr → @patchhouse.cr). One cheap Graph probe per
 * sibling (same probe as the daily token check), in parallel. Tenant-scoped; tokens never leave the
 * server; never throws (the connect itself already succeeded).
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { probeSocialAccountToken } from '@/lib/social-account-token-health'
import { lineDownLabel } from '@/lib/channel-silence-core'

const MAX_SIBLINGS = 10

/** Labels ("@patchhouse.cr") of the tenant's other Instagram lines that lost access just now. */
export async function recheckOtherInstagramLines(params: {
  tenantId: string
  keepIgAccountId: string
  now?: Date
}): Promise<string[]> {
  const now = params.now ?? new Date()
  try {
    const siblings = await prisma.socialAccount.findMany({
      where: {
        tenantId: params.tenantId,
        platform: 'instagram',
        isActive: true,
        disconnectedAt: null,
        // Already-dead lines were not dropped by THIS connect (and are announced already).
        tokenStatus: { notIn: ['revoked', 'expired', 'error'] },
        accountId: { not: params.keepIgAccountId },
      },
      select: {
        id: true, platform: true, accountId: true, accessToken: true, refreshToken: true, expiresAt: true,
        displayName: true, providerDisplayName: true, providerUsername: true, displayPhoneNumber: true,
      },
      take: MAX_SIBLINGS,
    })
    const results = await Promise.all(
      siblings.map(async (row) => {
        const probe = await probeSocialAccountToken(row)
        if (probe.transient) return null
        if (probe.tokenStatus !== 'revoked' && probe.tokenStatus !== 'expired' && probe.tokenStatus !== 'error') {
          return null
        }
        // lastErrorAt = now also makes the channel-silence cron announce it (bell + ops email).
        // Only while the probed token is still the stored one (a reconnect may have landed meanwhile).
        const res = await prisma.socialAccount.updateMany({
          where: { id: row.id, tenantId: params.tenantId, accessToken: row.accessToken },
          data: { tokenStatus: probe.tokenStatus, tokenLastCheckedAt: now, lastErrorCode: probe.lastErrorCode, lastErrorAt: now },
        })
        return res.count > 0 ? lineDownLabel(row) : null
      }),
    )
    return results.filter((x): x is string => Boolean(x))
  } catch (error) {
    console.warn('[instagram/sibling-recheck] failed', error instanceof Error ? error.name : 'error')
    return []
  }
}
