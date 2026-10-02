import 'server-only'
import { prismaRaw } from '@/lib/prisma-tenant'

/**
 * Customer data export / erasure (Ley 8968) is ON STANDBY (Rafael, 2026-09-30): nothing is offered
 * to businesses unless DATA_SUBJECT_REQUESTS=1 is set. Erasure additionally needs SQL 042
 * (do-not-re-import list + file outbox) — without it the erasure refuses instead of half-working.
 */
export function dataSubjectRequestsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DATA_SUBJECT_REQUESTS || '').trim() === '1'
}

export async function erasureTablesReady(): Promise<boolean> {
  try {
    const rows = await prismaRaw.$queryRaw<Array<{ ok: boolean }>>`
      SELECT (to_regclass('public."DataSubjectSuppression"') IS NOT NULL
          AND to_regclass('public."DataSubjectMediaPurge"') IS NOT NULL) AS ok`
    return rows[0]?.ok === true
  } catch {
    return false
  }
}
