import 'server-only'
import { prisma } from '@/lib/db'

/**
 * Per-business opt-in for reporting paid ad sales to the business's own Meta dataset.
 * Stored as TenantFeatureFlag `meta_sales_capi_v1` (scope = tenantId). OFF unless the owner / an
 * admin turned it on and accepted the notice. Nothing is ever sent unless the server switch
 * `META_SALES_CAPI_SENDER=1` is also set (Cloudflare only — never on the Railway preview, which
 * shares the production database).
 */
export const META_SALES_CAPI_FLAG = 'meta_sales_capi_v1'
const TEST_CODE_TTL_MS = 24 * 60 * 60_000

/**
 * Version of the notice the owner accepts. The first notice (no version stored) covered WhatsApp click ids
 * only; Instagram events (Instagram-scoped customer id) are sent only after the owner accepted this one.
 * WhatsApp keeps working on the old acceptance.
 */
export const META_SALES_NOTICE_VERSION = 'wa-ig-2026-10'

export type MetaSalesSettings = {
  enabled: boolean
  acknowledgedAt: string | null
  acknowledgedByUserId: string | null
  /** Which notice the owner accepted (null = the first, WhatsApp-only notice). */
  noticeVersion: string | null
  /** Meta Events Manager "test events" code; sent only while unexpired. */
  testEventCode: string | null
  testEventCodeExpiresAt: string | null
}

const OFF: MetaSalesSettings = {
  enabled: false,
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  noticeVersion: null,
  testEventCode: null,
  testEventCodeExpiresAt: null,
}

export function senderSwitchOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.META_SALES_CAPI_SENDER || '').trim() === '1'
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

export function parseSettings(row: { enabled: boolean; config: unknown } | null): MetaSalesSettings {
  if (!row) return OFF
  const c = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : {}
  const acknowledgedAt = str(c.acknowledgedAt, 40)
  return {
    // Never "on" without a recorded acknowledgement.
    enabled: row.enabled === true && acknowledgedAt !== null,
    acknowledgedAt,
    acknowledgedByUserId: str(c.acknowledgedByUserId, 64),
    noticeVersion: acknowledgedAt ? str(c.noticeVersion, 40) : null,
    testEventCode: str(c.testEventCode, 40),
    testEventCodeExpiresAt: str(c.testEventCodeExpiresAt, 40),
  }
}

/** Instagram events need the feature on AND the current notice (which names the Instagram id) accepted. */
export function instagramEventsAllowed(s: MetaSalesSettings): boolean {
  return s.enabled && s.noticeVersion === META_SALES_NOTICE_VERSION
}

export function activeTestEventCode(s: MetaSalesSettings, now = Date.now()): string | null {
  if (!s.testEventCode || !s.testEventCodeExpiresAt) return null
  const exp = Date.parse(s.testEventCodeExpiresAt)
  return Number.isFinite(exp) && exp > now ? s.testEventCode : null
}

export async function readMetaSalesSettings(tenantId: string): Promise<MetaSalesSettings> {
  if (!tenantId) return OFF
  const row = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId, scope: tenantId, key: META_SALES_CAPI_FLAG },
    select: { enabled: true, config: true },
  })
  return parseSettings(row)
}

/** Businesses that turned it on (ids only). */
export async function listEnabledTenants(): Promise<string[]> {
  const rows = await prisma.tenantFeatureFlag.findMany({
    where: { key: META_SALES_CAPI_FLAG, enabled: true, tenantId: { not: null } },
    select: { tenantId: true, enabled: true, config: true },
    take: 5_000,
  })
  return rows.filter((r) => parseSettings(r).enabled).map((r) => r.tenantId as string)
}

export async function writeMetaSalesSettings(
  tenantId: string,
  input: { enabled: boolean; acknowledge: boolean; userId: string; testEventCode?: string | null },
  now = new Date(),
): Promise<MetaSalesSettings> {
  const current = await readMetaSalesSettings(tenantId)
  if (input.enabled && !input.acknowledge && !(current.enabled && current.acknowledgedAt)) {
    throw new Error('ACK_REQUIRED')
  }
  // Turning it off clears the acknowledgement: turning it on again asks again.
  const acknowledgedAt = input.enabled ? (input.acknowledge ? now.toISOString() : current.acknowledgedAt) : null
  const acknowledgedByUserId = input.enabled ? (input.acknowledge ? input.userId : current.acknowledgedByUserId) : null
  const noticeVersion = input.enabled ? (input.acknowledge ? META_SALES_NOTICE_VERSION : current.noticeVersion) : null
  const code = input.testEventCode === undefined ? current.testEventCode : input.testEventCode ? input.testEventCode.trim().slice(0, 40) : null
  if (code && !/^TEST[0-9A-Za-z]{1,36}$/.test(code)) throw new Error('BAD_TEST_CODE')
  const testExpires =
    input.testEventCode === undefined ? current.testEventCodeExpiresAt : code ? new Date(now.getTime() + TEST_CODE_TTL_MS).toISOString() : null
  const config = {
    acknowledgedAt,
    acknowledgedByUserId,
    noticeVersion,
    testEventCode: code,
    testEventCodeExpiresAt: testExpires,
    updatedByUserId: input.userId,
    updatedAt: now.toISOString(),
  }
  await prisma.tenantFeatureFlag.upsert({
    where: { scope_key: { scope: tenantId, key: META_SALES_CAPI_FLAG } },
    create: { scope: tenantId, tenantId, key: META_SALES_CAPI_FLAG, enabled: input.enabled, config },
    update: { enabled: input.enabled, config },
  })
  return parseSettings({ enabled: input.enabled, config })
}
