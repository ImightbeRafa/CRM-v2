import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { ParsedAdReferral } from '@/lib/meta-attribution/referral'

/** Before SQL 039: skip the INSERT for a while instead of failing on every ad message. */
const MISSING_TABLE_BACKOFF_MS = 10 * 60_000
let tableMissingUntil = 0

/**
 * Saves the ad click that opened (or re-opened) a chat. Idempotent per line + provider message id
 * (Meta retries webhooks). Never throws: the webhook's 200 and Soft AI enqueue must not depend on it.
 * Missing table (SQL 039 not applied yet) is silent, so this code can ship before the SQL.
 */

export async function recordAdReferral(input: {
  tenantId: string
  socialAccountId: string
  conversationId: string
  messageId: string | null
  providerMessageId: string | null | undefined
  occurredAt: Date
  referral: ParsedAdReferral
}): Promise<{ recorded: boolean; reason?: string }> {
  const dedupeKey = (input.providerMessageId || '').slice(0, 300)
  if (!dedupeKey) return { recorded: false, reason: 'no_provider_message_id' }
  if (Date.now() < tableMissingUntil) return { recorded: false, reason: 'table_missing' }
  const r = input.referral
  try {
    // Small transaction so a lock on the table can never stall the webhook for long.
    const [, , inserted] = await prisma.$transaction([
      prisma.$executeRaw`SET LOCAL lock_timeout = '2s'`,
      prisma.$executeRaw`SET LOCAL statement_timeout = '3s'`,
      prisma.$executeRaw`
      INSERT INTO public."ChatAdReferral" (
        "id", "tenantId", "socialAccountId", "conversationId", "messageId", "platform", "dedupeKey",
        "sourceType", "sourceId", "sourceUrl", "headline", "body", "mediaType", "ctwaClid", "refParam",
        "occurredAt"
      )
      SELECT ${randomUUID()}, c."tenantId", c."socialAccountId", c."id", ${input.messageId},
        ${r.platform}, ${dedupeKey}, ${r.sourceType}, ${r.sourceId}, ${r.sourceUrl}, ${r.headline},
        ${r.body}, ${r.mediaType}, ${r.ctwaClid}, ${r.refParam}, ${input.occurredAt}
      FROM public."ChatConversation" c
      WHERE c."id" = ${input.conversationId} AND c."tenantId" = ${input.tenantId}
        AND c."socialAccountId" = ${input.socialAccountId}
      ON CONFLICT ("socialAccountId", "dedupeKey") DO NOTHING`,
    ])
    return { recorded: inserted > 0, reason: inserted > 0 ? undefined : 'duplicate_or_missing_conversation' }
  } catch (error) {
    if (isMissingTable(error)) {
      tableMissingUntil = Date.now() + MISSING_TABLE_BACKOFF_MS
      return { recorded: false, reason: 'table_missing' }
    }
    // Ids only — never the click id or ad text.
    console.warn('[meta-attribution] recordAdReferral failed', {
      tenantId: input.tenantId,
      socialAccountId: input.socialAccountId,
      conversationId: input.conversationId,
      code: errorCode(error),
    })
    return { recorded: false, reason: 'error' }
  }
}

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; meta?: { code?: unknown } } | null
  const code = e?.meta?.code ?? e?.code
  return typeof code === 'string' ? code : undefined
}

export function isMissingTable(error: unknown): boolean {
  const code = errorCode(error)
  if (code === 'P2021' || code === '42P01') return true
  const message = error instanceof Error ? error.message : ''
  return /42P01|relation .* does not exist/i.test(message)
}
