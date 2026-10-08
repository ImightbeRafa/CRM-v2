/**
 * Sources an owner gives an agent (SQL 052 "ChatAgentSource"). Tenant + agent scoped raw SQL; fail-safe while the
 * table is missing (StudioNotReadyError → 409 in routes). Raw files go to private storage
 * agent-sources/<tenant>/<agent>/<sha256>.<ext>; the extracted text is stored capped (120k chars).
 */
import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { chatStoragePut, chatStorageRemove, chatStorageUsage, isChatStorageConfigured } from '@/lib/chat-storage'

export class StudioNotReadyError extends Error {
  constructor() {
    super('STUDIO_NOT_READY')
    this.name = 'StudioNotReadyError'
  }
}

export type SourceKind = 'text' | 'url' | 'file' | 'image' | 'instagram' | 'wa_export'
export type SourceRow = {
  id: string
  kind: SourceKind
  status: 'pending' | 'fetching' | 'parsed' | 'failed' | 'removed'
  label: string
  url: string | null
  storagePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  pageCount: number | null
  textChars: number
  meta: Record<string, unknown>
  errorCode: string | null
  createdAt: string
}

const TABLE = 'ChatAgentSource'
export const MAX_SOURCES_PER_AGENT = 30
const MAX_TEXT = 120_000

export async function requireStudioReady() {
  if (!(await isTableReady(TABLE)) || !(await isTableReady('ChatAgentProfileDraft'))) throw new StudioNotReadyError()
}

function mapRow(r: Record<string, unknown>): SourceRow {
  return {
    id: String(r.id),
    kind: String(r.kind) as SourceKind,
    status: String(r.status) as SourceRow['status'],
    label: String(r.label),
    url: r.url ? String(r.url) : null,
    storagePath: r.storagePath ? String(r.storagePath) : null,
    mimeType: r.mimeType ? String(r.mimeType) : null,
    sizeBytes: r.sizeBytes == null ? null : Number(r.sizeBytes),
    pageCount: r.pageCount == null ? null : Number(r.pageCount),
    textChars: Number(r.textChars ?? 0),
    meta: (r.meta as Record<string, unknown>) || {},
    errorCode: r.errorCode ? String(r.errorCode) : null,
    createdAt: (r.createdAt as Date).toISOString(),
  }
}

export async function listSources(tenantId: string, agentId: string): Promise<SourceRow[]> {
  await requireStudioReady()
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "kind", "status", "label", "url", "storagePath", "mimeType", "sizeBytes", "pageCount",
           COALESCE(char_length("text"), 0) AS "textChars", "meta", "errorCode", "createdAt"
      FROM "ChatAgentSource"
     WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "status" <> 'removed'
     ORDER BY "createdAt" DESC LIMIT ${MAX_SOURCES_PER_AGENT + 10}`
  return rows.map(mapRow)
}

/** Texts of the given (or all parsed) sources, for the extractor. Tenant + agent scoped. */
export async function loadSourceTexts(tenantId: string, agentId: string, ids?: string[]) {
  await requireStudioReady()
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; label: string; url: string | null; text: string | null; storagePath: string | null; mimeType: string | null }>>`
    SELECT "id", "kind", "label", "url", "text", "storagePath", "mimeType" FROM "ChatAgentSource"
     WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "status" = 'parsed'
     ORDER BY "createdAt" ASC LIMIT ${MAX_SOURCES_PER_AGENT}`
  const wanted = ids && ids.length ? new Set(ids) : null
  return rows.filter((r) => !wanted || wanted.has(r.id))
}

export const STORAGE_QUOTA_BYTES = 300 * 1024 * 1024
export const PHOTOS_PER_TENANT_PER_DAY = 60

export class StudioQuotaError extends Error {
  constructor(readonly code: 'storage' | 'photos') {
    super(`STUDIO_QUOTA_${code}`)
    this.name = 'StudioQuotaError'
  }
}

/** Already have this exact content for this agent (and it was read)? Then no new AI call / upload is needed. */
export async function findParsedSourceBySha(tenantId: string, agentId: string, bytes: Buffer): Promise<SourceRow | null> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "kind", "status", "label", "url", "storagePath", "mimeType", "sizeBytes", "pageCount",
           COALESCE(char_length("text"), 0) AS "textChars", "meta", "errorCode", "createdAt"
      FROM "ChatAgentSource"
     WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "sha256" = ${sha256} AND "status" = 'parsed' LIMIT 1`
  return rows[0] ? mapRow(rows[0]) : null
}

/** Checks BEFORE any paid AI call or storage write for an upload: source cap, daily photo cap, storage quota. */
export async function assertCanAddUpload(tenantId: string, agentId: string, opts: { photo: boolean; bytes: number }) {
  await requireStudioReady()
  if ((await countSources(tenantId, agentId)) >= MAX_SOURCES_PER_AGENT) throw new TooManySourcesError()
  if (opts.photo) {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS "n" FROM "ChatAgentSource"
       WHERE "tenantId" = ${tenantId} AND "kind" = 'image' AND "createdAt" >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`
    if (Number(rows[0]?.n ?? 0) >= PHOTOS_PER_TENANT_PER_DAY) throw new StudioQuotaError('photos')
  }
  if (isChatStorageConfigured()) {
    const usage = await chatStorageUsage(`agent-sources/${tenantId}`).catch(() => null)
    if (usage && usage.bytes + opts.bytes > STORAGE_QUOTA_BYTES) throw new StudioQuotaError('storage')
  }
}

async function countSources(tenantId: string, agentId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS "n" FROM "ChatAgentSource"
     WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "status" <> 'removed'`
  return Number(rows[0]?.n ?? 0)
}

export class TooManySourcesError extends Error {
  constructor() {
    super('TOO_MANY_SOURCES')
    this.name = 'TooManySourcesError'
  }
}

/** Insert a parsed source (dedup per agent by content hash: the same file/text returns the existing row). */
export async function addSource(input: {
  tenantId: string
  agentId: string
  kind: SourceKind
  label: string
  url?: string | null
  text?: string | null
  bytes?: Buffer | null
  mimeType?: string | null
  ext?: string | null
  pageCount?: number | null
  meta?: Record<string, unknown>
  createdBy: string
  status?: 'parsed' | 'failed'
  errorCode?: string | null
}): Promise<SourceRow> {
  await requireStudioReady()
  if ((await countSources(input.tenantId, input.agentId)) >= MAX_SOURCES_PER_AGENT) throw new TooManySourcesError()
  const text = input.text ? input.text.slice(0, MAX_TEXT) : null
  const sha256 = createHash('sha256')
    .update(input.bytes ?? Buffer.from(`${input.kind}:${input.url ?? ''}:${text ?? ''}`, 'utf8'))
    .digest('hex')
  let storagePath: string | null = null
  if (input.bytes && input.ext && isChatStorageConfigured()) {
    storagePath = `agent-sources/${input.tenantId}/${input.agentId}/${sha256}.${input.ext}`
    await chatStoragePut(storagePath, new Uint8Array(input.bytes), input.mimeType || 'application/octet-stream', { overwrite: true })
  }
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "ChatAgentSource"
      ("id", "tenantId", "agentId", "kind", "status", "label", "url", "storagePath", "mimeType", "sizeBytes", "sha256",
       "pageCount", "text", "meta", "errorCode", "createdBy")
    VALUES (${id}, ${input.tenantId}, ${input.agentId}, ${input.kind}, ${input.status ?? 'parsed'}, ${input.label.slice(0, 200)},
            ${input.url ?? null}, ${storagePath}, ${input.mimeType ?? null}, ${input.bytes ? input.bytes.length : null}, ${sha256},
            ${input.pageCount ?? null}, ${text}, ${JSON.stringify(input.meta ?? {})}::jsonb, ${input.errorCode ?? null}, ${input.createdBy})
    -- Same content again (re-added after removal, or a retried photo): refresh everything, not just the status.
    ON CONFLICT ("agentId", "sha256") DO UPDATE SET
      "status" = EXCLUDED."status", "label" = EXCLUDED."label", "url" = EXCLUDED."url",
      "storagePath" = COALESCE(EXCLUDED."storagePath", "ChatAgentSource"."storagePath"),
      "mimeType" = EXCLUDED."mimeType", "sizeBytes" = EXCLUDED."sizeBytes", "pageCount" = EXCLUDED."pageCount",
      "text" = EXCLUDED."text", "meta" = EXCLUDED."meta", "errorCode" = EXCLUDED."errorCode", "updatedAt" = NOW()
    WHERE "ChatAgentSource"."tenantId" = ${input.tenantId}`
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "kind", "status", "label", "url", "storagePath", "mimeType", "sizeBytes", "pageCount",
           COALESCE(char_length("text"), 0) AS "textChars", "meta", "errorCode", "createdAt"
      FROM "ChatAgentSource" WHERE "tenantId" = ${input.tenantId} AND "agentId" = ${input.agentId} AND "sha256" = ${sha256}
     LIMIT 1`
  return mapRow(rows[0])
}

export async function removeSource(tenantId: string, agentId: string, sourceId: string): Promise<boolean> {
  await requireStudioReady()
  const rows = await prisma.$queryRaw<Array<{ storagePath: string | null }>>`
    SELECT "storagePath" FROM "ChatAgentSource" WHERE "id" = ${sourceId} AND "tenantId" = ${tenantId} AND "agentId" = ${agentId} LIMIT 1`
  const path = rows[0]?.storagePath
  // The raw file goes too (only our own agent-sources/<tenant>/ path; best effort).
  if (path && path.startsWith(`agent-sources/${tenantId}/${agentId}/`) && isChatStorageConfigured()) {
    await chatStorageRemove([path]).catch(() => undefined)
  }
  const n = await prisma.$executeRaw`
    UPDATE "ChatAgentSource" SET "status" = 'removed', "text" = NULL, "storagePath" = NULL, "updatedAt" = NOW()
     WHERE "id" = ${sourceId} AND "tenantId" = ${tenantId} AND "agentId" = ${agentId}`
  return n > 0
}
