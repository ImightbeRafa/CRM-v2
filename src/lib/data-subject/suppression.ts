import 'server-only'
import { createHmac } from 'crypto'
import { prismaRaw } from '@/lib/prisma-tenant'
import { customerPhoneKey } from '@/lib/data-subject/records'

/**
 * "Do not re-import" list for erased customers (Ley 8968): stores a keyed hash of the WhatsApp
 * number, never the number. Checked when WhatsApp history sync replays old chats, so an erased
 * customer's conversation is not rebuilt. A NEW message from the customer is a new contact and is
 * received normally.
 *
 * Key: DATA_SUBJECT_HASH_KEY (falls back to NEXTAUTH_SECRET). Rotating it makes old entries stop
 * matching (history could re-import erased chats) — rotate only with a re-hash plan.
 */
function hashKey(): string {
  const key = (process.env.DATA_SUBJECT_HASH_KEY || process.env.NEXTAUTH_SECRET || '').trim()
  if (!key) throw new Error('DATA_SUBJECT_HASH_KEY / NEXTAUTH_SECRET missing')
  return key
}

export function suppressionHash(tenantId: string, phone: string): string {
  return createHmac('sha256', hashKey()).update(`dsr-suppress:${tenantId}:phone:${phone}`).digest('hex')
}

/** True when this WhatsApp number belongs to a customer erased in this business. Fail-open on errors. */
export async function isPhoneSuppressed(tenantId: string, rawPhone: string | null | undefined): Promise<boolean> {
  const phone = customerPhoneKey(rawPhone)
  if (!tenantId || !phone) return false
  try {
    const rows = await prismaRaw.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok FROM public."DataSubjectSuppression"
      WHERE "tenantId" = ${tenantId} AND "kind" = 'phone' AND "valueHash" = ${suppressionHash(tenantId, phone)}
      LIMIT 1`
    return rows.length > 0
  } catch {
    return false
  }
}
