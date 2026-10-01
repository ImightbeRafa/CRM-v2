import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { ParsedAdReferral } from '@/lib/meta-attribution/referral'

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
  const r = input.referral
  try {
    const inserted = await prisma.$executeRaw`
      INSERT INTO public."ChatAdReferral" (
        "id", "tenantId", "socialAccountId", "conversationId", "messageId", "platform", "dedupeKey",
        "sourceType", "sourceId", "sourceUrl", "headline", "body", "mediaType", "ctwaClid", "refParam",
        "occurredAt"
      )
      SELECT ${randomUUID()}, c."tenantId", ${input.socialAccountId}, c."id", ${input.messageId},
        ${r.platform}, ${dedupeKey}, ${r.sourceType}, ${r.sourceId}, ${r.sourceUrl}, ${r.headline},
        ${r.body}, ${r.mediaType}, ${r.ctwaClid}, ${r.refParam}, ${input.occurredAt}
      FROM public."ChatConversation" c
      WHERE c."id" = ${input.conversationId} AND c."tenantId" = ${input.tenantId}
      ON CONFLICT ("socialAccountId", "dedupeKey") DO NOTHING`
    return { recorded: inserted > 0, reason: inserted > 0 ? undefined : 'duplicate_or_missing_conversation' }
  } catch (error) {
    if (isMissingTable(error)) return { recorded: false, reason: 'table_missing' }
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
