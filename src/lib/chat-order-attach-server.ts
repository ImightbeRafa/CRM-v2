import 'server-only'

import { prisma } from '@/lib/db'

/**
 * Order ids whose phone is one of `tails` (Costa Rica 8-digit numbers, see `phoneTail`), newest
 * first. Same rule in SQL: 8 digits, or 11 starting with 506; other countries never match.
 * `Order.phone` is free text ("8814-8939", "+506 8814 8939"), so digits are compared in SQL.
 * Raw SQL skips the archived-order extension: `deletedAt IS NULL` is explicit.
 */
export async function orderIdsByPhoneTails(tenantId: string, tails: string[], limit: number): Promise<string[]> {
  if (!tails.length) return []
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT o."id" FROM public."Order" o
    WHERE o."tenantId" = ${tenantId}
      AND o."deletedAt" IS NULL
      AND o."phone" IS NOT NULL
      AND (
        CASE
          WHEN regexp_replace(o."phone", '\\D', '', 'g') ~ '^[0-9]{8}$' THEN regexp_replace(o."phone", '\\D', '', 'g')
          WHEN regexp_replace(o."phone", '\\D', '', 'g') ~ '^506[0-9]{8}$' THEN right(regexp_replace(o."phone", '\\D', '', 'g'), 8)
        END
      ) = ANY(${tails}::text[])
    ORDER BY o."timestamp" DESC
    LIMIT ${limit}`
  return rows.map((r) => r.id)
}

/** Order ids whose phone digits contain `digits` (search box), newest first. */
export async function orderIdsByPhoneDigits(tenantId: string, digits: string, limit: number): Promise<string[]> {
  if (!/^\d{4,15}$/.test(digits)) return []
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT o."id" FROM public."Order" o
    WHERE o."tenantId" = ${tenantId}
      AND o."deletedAt" IS NULL
      AND o."phone" IS NOT NULL
      AND regexp_replace(o."phone", '\\D', '', 'g') LIKE ${'%' + digits + '%'}
    ORDER BY o."timestamp" DESC
    LIMIT ${limit}`
  return rows.map((r) => r.id)
}
