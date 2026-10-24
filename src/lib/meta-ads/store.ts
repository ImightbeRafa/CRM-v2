import 'server-only'
import { prisma } from '@/lib/db'
import { decryptSocialAccessToken, encryptSocialAccessToken } from '@/lib/social-account-crypto'
import {
  normalizeAdAccountId,
  parseFxRate,
  parseStoredAccounts,
  type AdAccountChoice,
  type AdConnectionStatus,
} from '@/lib/meta-ads/core'

/**
 * MetaAdConnection (SQL 064, raw SQL only, one row per business). Every query carries the tenant id from the
 * session. The token is encrypted at rest (enc:, same as SocialAccount) and only decrypted for a Graph call.
 * Before 064 is applied every read answers 'unavailable' and writes fail closed.
 */
export type AdConnection = {
  tenantId: string
  status: AdConnectionStatus
  adAccountId: string | null
  adAccountName: string | null
  currency: string | null
  timezoneName: string | null
  tokenExpiresAt: Date | null
  metaUserId: string | null
  accounts: AdAccountChoice[]
  storeFxRate: number | null
  lastErrorCode: string | null
  updatedAt: Date
}

type Row = Omit<AdConnection, 'accounts' | 'storeFxRate'> & { accounts: unknown; storeFxRate: unknown }

/** Missing table / column (064 not applied yet). */
export function isMissing064(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null
  const code = String(e?.meta?.code ?? e?.code ?? '')
  return code === '42P01' || code === '42703' || /MetaAdConnection.* does not exist|relation .*MetaAdConnection/i.test(String(e?.message || ''))
}

function toConnection(row: Row): AdConnection {
  return { ...row, accounts: parseStoredAccounts(row.accounts), storeFxRate: parseFxRate(row.storeFxRate) }
}

export async function readAdConnection(tenantId: string): Promise<AdConnection | null | 'unavailable'> {
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT "tenantId", "status", "adAccountId", "adAccountName", "currency", "timezoneName", "tokenExpiresAt",
             "metaUserId", "accounts", "storeFxRate", "lastErrorCode", "updatedAt"
        FROM public."MetaAdConnection" WHERE "tenantId" = ${tenantId}`
    return rows[0] ? toConnection(rows[0]) : null
  } catch (error) {
    if (isMissing064(error)) return 'unavailable'
    throw error
  }
}

/** Decrypted token for a Graph call (server only; never returned by any route). */
export async function readAdToken(tenantId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ accessToken: string }>>`
      SELECT "accessToken" FROM public."MetaAdConnection" WHERE "tenantId" = ${tenantId}`
    const token = decryptSocialAccessToken(rows[0]?.accessToken)
    return token || null
  } catch (error) {
    if (isMissing064(error)) return null
    throw error
  }
}

/** After the OAuth callback: one account → connected right away, several → the owner picks on the card. */
export async function saveAdConnectionFromLogin(input: {
  tenantId: string
  userId: string
  token: string
  expiresAt: Date | null
  metaUserId: string | null
  accounts: AdAccountChoice[]
}): Promise<AdConnectionStatus> {
  const single = input.accounts.length === 1 ? input.accounts[0] : null
  const status: AdConnectionStatus = single ? 'connected' : 'pending_pick'
  const token = encryptSocialAccessToken(input.token) as string
  const accounts = JSON.stringify(input.accounts)
  await prisma.$executeRaw`
    INSERT INTO public."MetaAdConnection" (
      "tenantId", "status", "adAccountId", "adAccountName", "currency", "timezoneName", "accessToken",
      "tokenExpiresAt", "metaUserId", "accounts", "connectedByUserId", "lastErrorCode", "lastErrorAt", "updatedAt"
    ) VALUES (
      ${input.tenantId}, ${status}, ${single?.id ?? null}, ${single?.name ?? null}, ${single?.currency ?? null},
      ${single?.timezoneName ?? null}, ${token}, ${input.expiresAt}, ${input.metaUserId}, ${accounts}::jsonb,
      ${input.userId}, NULL, NULL, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("tenantId") DO UPDATE SET
      "status" = EXCLUDED."status", "adAccountId" = EXCLUDED."adAccountId", "adAccountName" = EXCLUDED."adAccountName",
      "currency" = EXCLUDED."currency", "timezoneName" = EXCLUDED."timezoneName", "accessToken" = EXCLUDED."accessToken",
      "tokenExpiresAt" = EXCLUDED."tokenExpiresAt", "metaUserId" = EXCLUDED."metaUserId", "accounts" = EXCLUDED."accounts",
      "connectedByUserId" = EXCLUDED."connectedByUserId", "lastErrorCode" = NULL, "lastErrorAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP`
  return status
}

/** Pick one of the accounts Meta listed at login (never an id the client invents). */
export async function pickAdAccount(tenantId: string, rawId: unknown): Promise<'ok' | 'not_listed' | 'no_connection'> {
  const id = normalizeAdAccountId(rawId)
  const current = await readAdConnection(tenantId)
  if (!current || current === 'unavailable') return 'no_connection'
  const choice = id ? current.accounts.find((a) => a.id === id) : undefined
  if (!choice) return 'not_listed'
  await prisma.$executeRaw`
    UPDATE public."MetaAdConnection"
       SET "status" = 'connected', "adAccountId" = ${choice.id}, "adAccountName" = ${choice.name},
           "currency" = ${choice.currency}, "timezoneName" = ${choice.timezoneName}, "accounts" = '[]'::jsonb, "lastErrorCode" = NULL,
           "lastErrorAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "tenantId" = ${tenantId}`
  return 'ok'
}

export async function setAdFxRate(tenantId: string, raw: unknown): Promise<number | null> {
  const rate = parseFxRate(raw)
  await prisma.$executeRaw`
    UPDATE public."MetaAdConnection" SET "storeFxRate" = ${rate}, "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantId}`
  return rate
}

/** Real currency from the insights call (source of truth), written only when it changed. */
export async function syncAdCurrency(tenantId: string, currency: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public."MetaAdConnection" SET "currency" = ${currency}, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "tenantId" = ${tenantId} AND "currency" IS DISTINCT FROM ${currency}`.catch(() => undefined)
}

/**
 * token_invalid / missing_permission from a Graph call: written only when the state changes, and the stored token is
 * wiped (SecureDog INT: a user token of this app can still carry the person's other permissions after ads_read is
 * removed or it stops working for ads). The owner reconnects to read spend again.
 */
export async function markAdConnectionProblem(tenantId: string, status: AdConnectionStatus): Promise<void> {
  await prisma.$executeRaw`
    UPDATE public."MetaAdConnection"
       SET "status" = ${status}, "accessToken" = '', "lastErrorCode" = ${status}, "lastErrorAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "tenantId" = ${tenantId} AND ("status" IS DISTINCT FROM ${status} OR "accessToken" <> '')`.catch(() => undefined)
}

/** Disconnect: the row goes; the caller revokes ads_read with the returned token (best effort). */
export async function deleteAdConnection(tenantId: string): Promise<{ token: string | null; metaUserId: string | null } | null> {
  const rows = await prisma.$queryRaw<Array<{ accessToken: string; metaUserId: string | null }>>`
    DELETE FROM public."MetaAdConnection" WHERE "tenantId" = ${tenantId} RETURNING "accessToken", "metaUserId"`
  if (!rows[0]) return null
  return { token: decryptSocialAccessToken(rows[0].accessToken) || null, metaUserId: rows[0].metaUserId }
}

/** Other businesses connected with the same Facebook person (then ads_read must not be revoked at Meta). */
export async function countAdConnectionsOfMetaUser(metaUserId: string): Promise<number> {
  if (!/^\d{1,30}$/.test(metaUserId)) return 0
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM public."MetaAdConnection" WHERE "metaUserId" = ${metaUserId}`
  return rows[0]?.n ?? 0
}

/** Meta data-deletion / deauthorize callback: every ad connection made by that person, at once (no grace). */
export async function deleteAdConnectionsByMetaUser(metaUserId: string): Promise<number> {
  if (!/^\d{1,30}$/.test(metaUserId)) return 0
  try {
    return await prisma.$executeRaw`DELETE FROM public."MetaAdConnection" WHERE "metaUserId" = ${metaUserId}`
  } catch (error) {
    if (isMissing064(error)) return 0
    throw error
  }
}
