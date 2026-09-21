#!/usr/bin/env npx tsx
/**
 * One-off: refresh SocialAccount identity fields from Graph when NULL.
 * Dry-run by default. Usage:
 *   npx tsx scripts/chat-account-identity-backfill.ts
 *   npx tsx scripts/chat-account-identity-backfill.ts --apply
 *   npx tsx scripts/chat-account-identity-backfill.ts --apply --tenant=<id>
 */

import { prisma } from '../src/lib/db'
import { refreshMissingAccountIdentities } from '../src/lib/social-account-identity-refresh'
import { needsIdentityRefresh } from '../src/lib/social-account-identity'

async function main() {
  const apply = process.argv.includes('--apply')
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))
  const tenantId = tenantArg ? tenantArg.slice('--tenant='.length) : null

  const db = prisma as any
  const rows = await db.socialAccount.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      isActive: true,
      accessToken: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      platform: true,
      accountId: true,
      accessToken: true,
      refreshToken: true,
      displayName: true,
      providerDisplayName: true,
      providerUsername: true,
      displayPhoneNumber: true,
      wabaId: true,
      pageId: true,
      tokenLastCheckedAt: true,
    },
  })

  const needing = rows.filter((r: (typeof rows)[number]) => needsIdentityRefresh(r))
  console.log(
    JSON.stringify(
      {
        total: rows.length,
        needingRefresh: needing.length,
        apply,
        tenantId,
        sample: needing.slice(0, 10).map((r: (typeof rows)[number]) => ({
          id: r.id,
          platform: r.platform,
          accountId: r.accountId,
        })),
      },
      null,
      2,
    ),
  )

  if (!apply) {
    console.log('Dry-run only. Pass --apply to refresh via Graph (throttled ≤1/h/account).')
    return
  }

  const result = await refreshMissingAccountIdentities(needing)
  console.log(JSON.stringify({ result }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
