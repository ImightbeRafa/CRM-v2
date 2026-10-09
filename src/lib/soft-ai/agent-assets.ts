/**
 * Images the agent can send with its replies (Phase B2) — e.g. a size guide or a promo flyer the team already uses.
 * Tables from SQL 029 (+053 agentId/inventoryCategory): ChatAgentAsset, ChatAgentShortcutAsset (≤3 per reply).
 * Raw SQL (no Prisma client change), always scoped by tenant AND agent. Every image is re-encoded with sharp:
 * jpeg/png only (WhatsApp rejects webp), ≤1600 px, metadata (EXIF/GPS) stripped. Bytes live in the private
 * chat bucket under agent-assets/<tenant>/<sha256>.<ext>; the stored "publicUrl" is our own logged-in route,
 * never a public link. Removing an image archives it (old chat bubbles may still point at the bytes).
 */
import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { isColumnReady, isTableReady } from '@/lib/soft-ai/table-ready'
import { chatStorageGet, chatStoragePut, isChatStorageConfigured } from '@/lib/chat-storage'
import { hasRasterPhotoSignature, withImageDecodeSlot } from '@/lib/chat-media-thumb'

export const MAX_ASSET_INPUT_BYTES = 8 * 1024 * 1024
export const MAX_ASSET_STORED_BYTES = 5 * 1024 * 1024
export const ASSET_QUOTA_BYTES = 200 * 1024 * 1024
export const MAX_IMAGES_PER_REPLY = 3

export type AgentAsset = {
  id: string
  name: string
  caption: string | null
  mimeType: 'image/jpeg' | 'image/png'
  sizeBytes: number
  width: number | null
  height: number | null
  sha256: string
  blobPath: string
  agentId: string | null
  url: string
}

export class AgentAssetError extends Error {
  constructor(readonly code: 'not_ready' | 'not_image' | 'too_large' | 'quota' | 'not_found' | 'storage' | 'busy') {
    super(code)
    this.name = 'AgentAssetError'
  }
}

export async function agentAssetsReady(): Promise<boolean> {
  return (
    isChatStorageConfigured() &&
    (await isTableReady('ChatAgentAsset')) &&
    (await isTableReady('ChatAgentShortcutAsset')) &&
    (await isColumnReady('ChatAgentAsset', 'agentId'))
  )
}

const assetUrl = (agentId: string, id: string) => `/api/chat/agents/${encodeURIComponent(agentId)}/assets/${encodeURIComponent(id)}`

function mapAsset(r: Record<string, unknown>, agentId: string): AgentAsset {
  return {
    id: String(r.id),
    name: String(r.name),
    caption: r.caption ? String(r.caption) : null,
    mimeType: r.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
    sizeBytes: Number(r.sizeBytes ?? 0),
    width: r.width == null ? null : Number(r.width),
    height: r.height == null ? null : Number(r.height),
    sha256: String(r.sha256),
    blobPath: String(r.blobPath),
    agentId: r.agentId ? String(r.agentId) : null,
    url: assetUrl(agentId, String(r.id)),
  }
}

/** Decompression-bomb guard: a size guide or flyer never needs more (MEDIA-11). */
const MAX_INPUT_PIXELS = 25_000_000

/**
 * Re-encode an image: jpeg (or png when it has transparency), ≤1600 px, no metadata. Only real JPEG / PNG / WebP
 * BYTES reach sharp (magic numbers; TIFF / HEIF / AVIF / SVG never touch a decoder), inside the process-wide 2-slot
 * decode limit shared with chat previews, 5 s per decode, refused when the queue is full (MEDIA-11).
 */
export async function normalizeImage(bytes: Buffer): Promise<{ bytes: Buffer; mime: 'image/jpeg' | 'image/png'; width: number; height: number }> {
  if (bytes.length === 0 || bytes.length > MAX_ASSET_INPUT_BYTES) throw new AgentAssetError(bytes.length ? 'too_large' : 'not_image')
  if (!hasRasterPhotoSignature(bytes)) throw new AgentAssetError('not_image')
  try {
    return await withImageDecodeSlot(async () => {
      const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata()
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new AgentAssetError('not_image')
      // Transparency (png / webp) stays png: jpeg would turn it black.
      const png = Boolean(meta.hasAlpha)
      const pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .timeout({ seconds: 5 })
      const out = png ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
      if (out.data.length > MAX_ASSET_STORED_BYTES) throw new AgentAssetError('too_large')
      return { bytes: out.data, mime: png ? ('image/png' as const) : ('image/jpeg' as const), width: out.info.width, height: out.info.height }
    })
  } catch (error) {
    if (error instanceof AgentAssetError) throw error
    if (error instanceof Error && error.message === 'IMAGE_BUSY') throw new AgentAssetError('busy')
    throw new AgentAssetError('not_image')
  }
}

/** Store (or reuse) an image for this agent. Same image twice → same row (unique per tenant + sha256). */
export async function storeAgentAsset(input: {
  tenantId: string
  agentId: string
  bytes: Buffer
  name: string
  caption?: string | null
  userId: string
}): Promise<AgentAsset> {
  if (!(await agentAssetsReady())) throw new AgentAssetError('not_ready')
  const img = await normalizeImage(input.bytes)
  const sha256 = createHash('sha256').update(img.bytes).digest('hex')
  const existing = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatAgentAsset" WHERE "tenantId" = ${input.tenantId} AND "sha256" = ${sha256} LIMIT 1`
  if (existing[0]) {
    // Shared by several agents of the business → usable by any of them (agentId NULL); re-activate if archived.
    const shared = existing[0].agentId && existing[0].agentId !== input.agentId
    await prisma.$executeRaw`
      UPDATE "ChatAgentAsset" SET "status" = 'active', "updatedAt" = NOW(),
             "agentId" = CASE WHEN ${Boolean(shared)} THEN NULL ELSE "agentId" END
       WHERE "id" = ${String(existing[0].id)} AND "tenantId" = ${input.tenantId}`
    const row = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "ChatAgentAsset" WHERE "id" = ${String(existing[0].id)} AND "tenantId" = ${input.tenantId} LIMIT 1`
    return mapAsset(row[0], input.agentId)
  }
  const used = await prisma.$queryRaw<Array<{ bytes: bigint | null }>>`
    SELECT COALESCE(SUM("sizeBytes"), 0)::bigint AS "bytes" FROM "ChatAgentAsset" WHERE "tenantId" = ${input.tenantId}`
  if (Number(used[0]?.bytes ?? 0) + img.bytes.length > ASSET_QUOTA_BYTES) throw new AgentAssetError('quota')
  const ext = img.mime === 'image/png' ? 'png' : 'jpg'
  const blobPath = `agent-assets/${input.tenantId}/${sha256}.${ext}`
  try {
    await chatStoragePut(blobPath, new Uint8Array(img.bytes), img.mime, { overwrite: true })
  } catch {
    throw new AgentAssetError('storage')
  }
  const id = randomUUID()
  const name = (input.name || 'imagen').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'imagen'
  const caption = input.caption ? input.caption.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) || null : null
  await prisma.$executeRaw`
    INSERT INTO "ChatAgentAsset"
      ("id", "tenantId", "agentId", "kind", "name", "caption", "blobPath", "publicUrl", "mimeType", "sizeBytes",
       "width", "height", "sha256", "status", "createdBy", "createdAt", "updatedAt")
    VALUES (${id}, ${input.tenantId}, ${input.agentId}, 'other', ${name}, ${caption}, ${blobPath}, ${assetUrl(input.agentId, id)},
            ${img.mime}, ${img.bytes.length}, ${img.width}, ${img.height}, ${sha256}, 'active', ${input.userId}, NOW(), NOW())
    ON CONFLICT DO NOTHING`
  // Same image uploaded twice at once: the unique (tenant, sha256) row wins; both callers get it.
  const row = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatAgentAsset" WHERE "tenantId" = ${input.tenantId} AND "sha256" = ${sha256} LIMIT 1`
  if (!row[0]) throw new AgentAssetError('storage')
  return mapAsset(row[0], input.agentId)
}

/** What the browser gets: no storage path, hash or owner fields. */
export function publicAgentAsset(a: AgentAsset) {
  return { id: a.id, name: a.name, caption: a.caption, mimeType: a.mimeType, width: a.width, height: a.height, url: a.url }
}

/** Active images this agent may use (its own + the business's shared ones). */
export async function listAgentAssets(tenantId: string, agentId: string): Promise<AgentAsset[]> {
  if (!(await agentAssetsReady())) return []
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatAgentAsset"
     WHERE "tenantId" = ${tenantId} AND "status" = 'active' AND ("agentId" = ${agentId} OR "agentId" IS NULL)
     ORDER BY "createdAt" DESC LIMIT 100`
  return rows.map((r) => mapAsset(r, agentId))
}

/** One asset this agent may use — or null (other tenant / other agent / archived). */
export async function getAgentAsset(tenantId: string, agentId: string, assetId: string, opts: { includeArchived?: boolean } = {}) {
  if (!(await agentAssetsReady())) return null
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatAgentAsset"
     WHERE "id" = ${assetId} AND "tenantId" = ${tenantId} AND ("agentId" = ${agentId} OR "agentId" IS NULL)
     LIMIT 1`
  if (!rows[0]) return null
  if (!opts.includeArchived && rows[0].status !== 'active') return null
  return mapAsset(rows[0], agentId)
}

export async function readAgentAssetBytes(asset: AgentAsset): Promise<Buffer> {
  if (!asset.blobPath.startsWith('agent-assets/')) throw new AgentAssetError('not_found')
  return (await chatStorageGet(asset.blobPath)).bytes
}

/** Archive (never delete bytes: chat history may show it). Also unlinks it from this agent's replies. */
export async function archiveAgentAsset(tenantId: string, agentId: string, assetId: string): Promise<boolean> {
  const asset = await getAgentAsset(tenantId, agentId, assetId)
  if (!asset) return false
  await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM "ChatAgentShortcutAsset" sa USING "ChatAgentShortcut" s
       WHERE sa."shortcutId" = s."id" AND s."agentId" = ${agentId} AND sa."tenantId" = ${tenantId} AND sa."assetId" = ${assetId}`,
    // Only an agent-owned image is archived; a shared one just stops being used by this agent's replies.
    prisma.$executeRaw`
      UPDATE "ChatAgentAsset" SET "status" = 'archived', "updatedAt" = NOW()
       WHERE "id" = ${assetId} AND "tenantId" = ${tenantId} AND "agentId" = ${agentId}`,
    // INT-79: an image change is an agent change (re-test / strict unlock see a new version).
    prisma.chatAgent.updateMany({ where: { id: agentId, tenantId }, data: { version: { increment: 1 } } }),
  ])
  return true
}

/** Set the images (≤3, in order) of one of THIS agent's replies. Every id is re-checked against tenant + agent. */
export async function setReplyAssets(input: { tenantId: string; agentId: string; shortcutId: string; assetIds: string[] }): Promise<string[]> {
  if (!(await agentAssetsReady())) throw new AgentAssetError('not_ready')
  const shortcut = await prisma.chatAgentShortcut.findFirst({
    where: { id: input.shortcutId, tenantId: input.tenantId, agentId: input.agentId },
    select: { id: true },
  })
  if (!shortcut) throw new AgentAssetError('not_found')
  const wanted = [...new Set(input.assetIds.filter((x) => typeof x === 'string'))].slice(0, MAX_IMAGES_PER_REPLY)
  const valid: string[] = []
  for (const id of wanted) if (await getAgentAsset(input.tenantId, input.agentId, id)) valid.push(id)
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "ChatAgentShortcutAsset" WHERE "shortcutId" = ${shortcut.id} AND "tenantId" = ${input.tenantId}`,
    ...valid.map(
      (assetId, position) => prisma.$executeRaw`
        INSERT INTO "ChatAgentShortcutAsset" ("id", "tenantId", "shortcutId", "assetId", "position", "createdAt")
        VALUES (${randomUUID()}, ${input.tenantId}, ${shortcut.id}, ${assetId}, ${position}, NOW())`,
    ),
    // INT-79: an image change is an agent change (re-test / strict unlock see a new version).
    prisma.chatAgent.updateMany({ where: { id: input.agentId, tenantId: input.tenantId }, data: { version: { increment: 1 } } }),
  ])
  return valid
}

/** Images per reply for this agent (active assets only, in position order). */
export async function loadReplyAssets(tenantId: string, agentId: string): Promise<Map<string, AgentAsset[]>> {
  const out = new Map<string, AgentAsset[]>()
  if (!(await agentAssetsReady())) return out
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT sa."shortcutId" AS "linkShortcutId", sa."position" AS "linkPosition", a.*
      FROM "ChatAgentShortcutAsset" sa
      JOIN "ChatAgentShortcut" s ON s."id" = sa."shortcutId" AND s."tenantId" = sa."tenantId"
      JOIN "ChatAgentAsset" a ON a."id" = sa."assetId" AND a."tenantId" = sa."tenantId"
     WHERE sa."tenantId" = ${tenantId} AND s."agentId" = ${agentId} AND a."status" = 'active'
       AND (a."agentId" = ${agentId} OR a."agentId" IS NULL)
     ORDER BY sa."shortcutId", sa."position"`
  for (const r of rows) {
    const key = String(r.linkShortcutId)
    const list = out.get(key) ?? []
    list.push(mapAsset(r, agentId))
    out.set(key, list)
  }
  return out
}
