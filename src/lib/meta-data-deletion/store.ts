/**
 * Prisma side of the Meta data-deletion flow (rules in ./core). The 058 column / table are read with raw SQL
 * only, never through the Prisma models, so this code is safe before 058 is applied: it then matches the old way
 * (Instagram account id) and records nothing.
 */
import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { chatStorageRemove } from '@/lib/chat-storage'
import { purgeChatOnlyWorkspaceData } from '@/lib/workspace-purge'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { softUnlinkUpdateData } from '@/lib/social-account-token-health'
import { reportError } from '@/lib/observability/report-error'
import {
  safeTenantChatPaths,
  type DeletionKind,
  type DeletionRequestPatch,
  type DeletionRequestRow,
  type DeletionStatus,
  type DeletionStore,
  type MetaLineRef,
  type RemovePaths,
} from './core'

/** Missing 058 table (42P01) or column (42703). */
export function isMissing058(error: unknown): boolean {
  if (isMissingRelation(error)) return true
  const e = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown }
  if (String(e?.code || '') === '42703' || String(e?.meta?.code || '') === '42703') return true
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') return true
  return /column .*metaUserId.* does not exist/i.test(String(e?.message || ''))
}

type RawRequest = Omit<DeletionRequestRow, 'accountIds' | 'pendingPaths'> & { accountIds: unknown; pendingPaths: unknown }

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

function toRow(raw: RawRequest): DeletionRequestRow {
  return { ...raw, accountIds: asStrings(raw.accountIds), pendingPaths: asStrings(raw.pendingPaths) }
}

/**
 * Lines connected by this Facebook user (058 column), plus the old match on the Instagram account id kept for
 * accounts connected before 058.
 */
async function findLines(metaUserId: string): Promise<MetaLineRef[]> {
  try {
    return await prisma.$queryRaw<MetaLineRef[]>`
      SELECT id, "tenantId", platform FROM "SocialAccount"
      WHERE "metaUserId" = ${metaUserId}
         OR (platform = 'instagram' AND "accountId" = ${metaUserId})`
  } catch (error) {
    if (!isMissing058(error)) throw error
    return prisma.$queryRaw<MetaLineRef[]>`
      SELECT id, "tenantId", platform FROM "SocialAccount"
      WHERE platform = 'instagram' AND "accountId" = ${metaUserId}`
  }
}

async function findLinesByIds(ids: string[]): Promise<MetaLineRef[]> {
  if (!ids.length) return []
  return prisma.$queryRaw<MetaLineRef[]>`
    SELECT id, "tenantId", platform FROM "SocialAccount" WHERE id = ANY(${ids}::text[])`
}

/** Every stored file of the line's chats: message media (column + legacy metadata) and customer photos. */
async function collectPaths(line: MetaLineRef): Promise<string[]> {
  const media = await prisma.$queryRaw<Array<{ p: string | null; m: string | null }>>`
    SELECT "mediaBlobPath" AS p, ("metadata"->>'mediaBlobPath') AS m
    FROM "ChatMessage"
    WHERE "socialAccountId" = ${line.id} AND "tenantId" = ${line.tenantId}
      AND ("mediaBlobPath" IS NOT NULL OR "metadata" ? 'mediaBlobPath')`
  const avatars = await prisma.$queryRaw<Array<{ p: string | null }>>`
    SELECT "peerAvatarUrl" AS p FROM "ChatConversation"
    WHERE "socialAccountId" = ${line.id} AND "tenantId" = ${line.tenantId} AND "peerAvatarUrl" IS NOT NULL`
  const account = await prisma.$queryRaw<Array<{ p: string | null }>>`
    SELECT "avatarUrl" AS p FROM "SocialAccount" WHERE id = ${line.id}`
  return safeTenantChatPaths(line.tenantId, [
    ...media.flatMap((r) => [r.p, r.m]),
    ...avatars.map((r) => r.p),
    ...account.map((r) => r.p),
  ])
}

async function disconnectData(lineId: string) {
  const rows = await prisma.$queryRaw<Array<{ pageId: string | null; wabaId: string | null; refreshToken: string | null }>>`
    SELECT "pageId", "wabaId", "refreshToken" FROM "SocialAccount" WHERE id = ${lineId}`
  const row = rows[0]
  const meta = parseSocialRefreshToken(row?.refreshToken)
  return {
    ...softUnlinkUpdateData(),
    pageId: row?.pageId || meta.pageId || null,
    wabaId: row?.wabaId || meta.whatsappBusinessAccountId || null,
  }
}

/** Same as Settings → Disconnect: tokens cleared, line off, history kept. */
async function disconnectLine(line: MetaLineRef): Promise<void> {
  await prisma.socialAccount.update({ where: { id: line.id }, data: await disconnectData(line.id) })
}

/**
 * Deletes what came through the line (chats cascade to referrals, agent turns, suggestions, jobs) and disconnects
 * it. Messages are deleted by line as well: their conversation link is SET NULL, not cascade.
 */
async function eraseLine(line: MetaLineRef): Promise<void> {
  const chats = await prisma.chatConversation.findMany({
    where: { socialAccountId: line.id, tenantId: line.tenantId },
    select: { id: true },
  })
  const chatIds = chats.map((c) => c.id)
  await purgeChatOnlyWorkspaceData(chatIds)
  const data = await disconnectData(line.id)
  await prisma.$transaction(async (tx) => {
    await tx.chatMessage.deleteMany({ where: { socialAccountId: line.id, tenantId: line.tenantId } })
    if (chatIds.length) await tx.chatMessage.deleteMany({ where: { conversationId: { in: chatIds } } })
    await tx.chatConversation.deleteMany({ where: { socialAccountId: line.id, tenantId: line.tenantId } })
    await tx.socialAccount.update({
      where: { id: line.id },
      data: { ...data, providerDisplayName: null, providerUsername: null, avatarUrl: null },
    })
  }, { timeout: 30_000 })
  // Outside the transaction: these may not exist yet (039 / 041 / 058) and a failure must not undo the erase.
  await prisma.$executeRaw`DELETE FROM "ChatAdReferral" WHERE "socialAccountId" = ${line.id}`.catch((e) => {
    if (!isMissingRelation(e)) throw e
  })
  await prisma.$executeRaw`
    DELETE FROM "MetaConversionEvent" WHERE "socialAccountId" = ${line.id} AND status IN ('pending', 'processing')`.catch((e) => {
    if (!isMissingRelation(e)) throw e
  })
  await prisma.$executeRaw`UPDATE "SocialAccount" SET "metaUserId" = NULL WHERE id = ${line.id}`.catch((e) => {
    if (!isMissing058(e)) throw e
  })
}

async function findRecentRequest(metaUserKey: string, kind: DeletionKind, since: Date): Promise<DeletionRequestRow | null> {
  try {
    const rows = await prisma.$queryRaw<RawRequest[]>`
      SELECT id, "confirmationCode", kind, status, "matchedAccounts", "accountIds", "pendingPaths", attempts,
             "lastErrorCode", "createdAt", "updatedAt", "completedAt"
      FROM "MetaDataDeletionRequest"
      WHERE "metaUserKey" = ${metaUserKey} AND kind = ${kind} AND "createdAt" >= ${since}
      ORDER BY "createdAt" DESC LIMIT 1`
    return rows[0] ? toRow(rows[0]) : null
  } catch (error) {
    if (isMissing058(error)) return null
    throw error
  }
}

async function insertRequest(row: DeletionRequestRow & { metaUserKey: string }): Promise<boolean> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "MetaDataDeletionRequest"
        (id, "confirmationCode", kind, "metaUserKey", status, "matchedAccounts", "accountIds", "pendingPaths",
         attempts, "lastErrorCode", "createdAt", "updatedAt", "completedAt")
      VALUES (${row.id}, ${row.confirmationCode}, ${row.kind}, ${row.metaUserKey}, ${row.status}, ${row.matchedAccounts},
              ${JSON.stringify(row.accountIds)}::jsonb, ${JSON.stringify(row.pendingPaths)}::jsonb, ${row.attempts},
              ${row.lastErrorCode}, ${row.createdAt}, ${row.updatedAt}, ${row.completedAt})`
    return true
  } catch (error) {
    if (isMissing058(error)) return false
    throw error
  }
}

async function updateRequest(id: string, patch: DeletionRequestPatch): Promise<void> {
  const sets: Prisma.Sql[] = [Prisma.sql`"updatedAt" = NOW()`]
  if (patch.status !== undefined) sets.push(Prisma.sql`status = ${patch.status}`)
  if (patch.pendingPaths !== undefined) sets.push(Prisma.sql`"pendingPaths" = ${JSON.stringify(patch.pendingPaths)}::jsonb`)
  if (patch.accountIds !== undefined) sets.push(Prisma.sql`"accountIds" = ${JSON.stringify(patch.accountIds)}::jsonb`)
  if (patch.attempts !== undefined) sets.push(Prisma.sql`attempts = ${patch.attempts}`)
  if (patch.matchedAccounts !== undefined) sets.push(Prisma.sql`"matchedAccounts" = ${patch.matchedAccounts}`)
  if (patch.lastErrorCode !== undefined) sets.push(Prisma.sql`"lastErrorCode" = ${patch.lastErrorCode}`)
  if (patch.completedAt !== undefined) sets.push(Prisma.sql`"completedAt" = ${patch.completedAt}`)
  await prisma.$executeRaw`UPDATE "MetaDataDeletionRequest" SET ${Prisma.join(sets, ', ')} WHERE id = ${id}`
}

async function listOpenRequests(olderThan: Date, limit: number): Promise<DeletionRequestRow[]> {
  try {
    const rows = await prisma.$queryRaw<RawRequest[]>`
      SELECT id, "confirmationCode", kind, status, "matchedAccounts", "accountIds", "pendingPaths", attempts,
             "lastErrorCode", "createdAt", "updatedAt", "completedAt"
      FROM "MetaDataDeletionRequest"
      WHERE status IN ('received', 'pending', 'pending_storage') AND "updatedAt" < ${olderThan}
      ORDER BY "updatedAt" ASC LIMIT ${limit}`
    return rows.map(toRow)
  } catch (error) {
    if (isMissing058(error)) return []
    throw error
  }
}

export const prismaDeletionStore: DeletionStore = {
  findLines,
  findLinesByIds,
  collectPaths,
  eraseLine,
  disconnectLine,
  findRecentRequest,
  insertRequest,
  updateRequest,
  listOpenRequests,
}

export const removeChatPaths: RemovePaths = (paths) => chatStorageRemove(paths)

/** Status page lookup: status and dates only. */
export async function readDeletionStatus(
  code: string,
): Promise<{ status: DeletionStatus; kind: DeletionKind; createdAt: Date; completedAt: Date | null } | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ status: DeletionStatus; kind: DeletionKind; createdAt: Date; completedAt: Date | null }>>`
      SELECT status, kind, "createdAt", "completedAt" FROM "MetaDataDeletionRequest"
      WHERE "confirmationCode" = ${code} LIMIT 1`
    return rows[0] ?? null
  } catch (error) {
    if (isMissing058(error)) return null
    throw error
  }
}

/** Remember which Facebook user connected a line (058). Never blocks a connection. */
export async function recordLineMetaUser(params: {
  tenantId: string
  platform: 'instagram' | 'whatsapp'
  accountId: string
  metaUserId: string | null | undefined
}): Promise<void> {
  const metaUserId = String(params.metaUserId || '').trim()
  if (!/^\d{1,30}$/.test(metaUserId)) return
  try {
    await prisma.$executeRaw`
      UPDATE "SocialAccount" SET "metaUserId" = ${metaUserId}
      WHERE "tenantId" = ${params.tenantId} AND platform = ${params.platform} AND "accountId" = ${params.accountId}`
  } catch (error) {
    if (!isMissing058(error)) console.warn('[meta-data-deletion] metaUserId not saved', error instanceof Error ? error.name : 'unknown')
  }
}

/** Fill metaUserId for lines connected before 058, from debug_token's user_id (only when still empty). */
export async function backfillLineMetaUser(lineId: string, metaUserId: string | null | undefined): Promise<void> {
  const id = String(metaUserId || '').trim()
  if (!/^\d{1,30}$/.test(id)) return
  try {
    await prisma.$executeRaw`UPDATE "SocialAccount" SET "metaUserId" = ${id} WHERE id = ${lineId} AND "metaUserId" IS NULL`
  } catch (error) {
    if (!isMissing058(error)) console.warn('[meta-data-deletion] metaUserId backfill failed', error instanceof Error ? error.name : 'unknown')
  }
}

export function reportDeletionFailure(stage: string, code: string): void {
  reportError({ source: 'server', name: 'MetaDataDeletionError', message: `meta data deletion ${stage} failed: ${code}`, route: '/api/auth/instagram/data-deletion' })
}
