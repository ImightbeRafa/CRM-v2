import { prisma } from '@/lib/db'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import {
  fetchInstagramPageIdentity,
  verifyWhatsAppAssetsForToken,
} from '@/lib/meta-api'
import {
  identityPersistPayload,
  needsIdentityRefresh,
} from '@/lib/social-account-identity'

const IDENTITY_REFRESH_THROTTLE_MS = 60 * 60 * 1000

/** GET /api/chat/accounts Graph budget. Backfill omits this so jobs can finish. */
export const IDENTITY_REFRESH_TIMEOUT_MS = 2_000
const IDENTITY_REFRESH_CONCURRENCY = 4

export type IdentityAccountRow = {
  id: string
  platform: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  displayName: string | null
  providerDisplayName: string | null
  providerUsername: string | null
  displayPhoneNumber: string | null
  wabaId: string | null
  pageId: string | null
  tokenLastCheckedAt: Date | null
}

export type IdentityRefreshJob = (
  row: IdentityAccountRow,
  signal: AbortSignal | undefined,
) => Promise<boolean>

export type RefreshMissingIdentitiesOptions = {
  /** Combined with timeoutMs when both are set. */
  signal?: AbortSignal
  /** 0 / omitted = no deadline (one-off backfill). GET passes IDENTITY_REFRESH_TIMEOUT_MS. */
  timeoutMs?: number
  claimSlot?: (accountId: string) => Promise<boolean>
  refreshWhatsApp?: IdentityRefreshJob
  refreshInstagram?: IdentityRefreshJob
}

/**
 * Atomically claim a ≤1/h refresh slot via tokenLastCheckedAt.
 * Returns true when this caller owns the refresh attempt.
 */
export async function claimIdentityRefreshSlot(
  accountId: string,
  now = new Date(),
): Promise<boolean> {
  const db = prisma as any
  const cutoff = new Date(now.getTime() - IDENTITY_REFRESH_THROTTLE_MS)
  const result = await db.socialAccount.updateMany({
    where: {
      id: accountId,
      OR: [{ tokenLastCheckedAt: null }, { tokenLastCheckedAt: { lt: cutoff } }],
    },
    data: { tokenLastCheckedAt: now },
  })
  return (result?.count ?? 0) > 0
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

function startRefreshDeadline(
  timeoutMs: number | undefined,
  external?: AbortSignal,
): { signal: AbortSignal | undefined; dispose: () => void } {
  const wantsTimeout = typeof timeoutMs === 'number' && timeoutMs > 0
  if (!wantsTimeout && !external) return { signal: undefined, dispose: () => undefined }

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  let timer: ReturnType<typeof setTimeout> | undefined

  if (wantsTimeout) {
    timer = setTimeout(() => controller.abort(), timeoutMs)
  }
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let next = 0
  const workerCount = Math.min(Math.max(1, limit), items.length)
  async function worker() {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

async function refreshWhatsAppIdentity(
  row: IdentityAccountRow,
  signal?: AbortSignal,
): Promise<boolean> {
  const token = decryptSocialAccessToken(row.accessToken)
  if (!token) return false
  const meta = parseSocialRefreshToken(row.refreshToken)
  const wabaId = row.wabaId || meta.whatsappBusinessAccountId
  const verified = await verifyWhatsAppAssetsForToken({
    accessToken: token,
    phoneNumberId: row.accountId,
    whatsappBusinessAccountId: wabaId,
    signal,
  })
  if (!verified.ok) return false

  const identity = identityPersistPayload({
    platform: 'whatsapp',
    providerDisplayName: verified.providerDisplayName,
    displayPhoneNumber: verified.displayPhoneNumber,
    wabaId: verified.whatsappBusinessAccountId || wabaId,
    existingDisplayName: row.displayName,
  })

  const db = prisma as any
  await db.socialAccount.update({
    where: { id: row.id },
    data: {
      providerDisplayName: identity.providerDisplayName,
      displayPhoneNumber: identity.displayPhoneNumber,
      wabaId: identity.wabaId,
      displayName: identity.displayName,
    },
  })
  return true
}

async function refreshInstagramIdentity(
  row: IdentityAccountRow,
  signal?: AbortSignal,
): Promise<boolean> {
  const token = decryptSocialAccessToken(row.accessToken)
  if (!token) return false
  const meta = parseSocialRefreshToken(row.refreshToken)
  const pageId = row.pageId || meta.pageId
  if (!pageId) return false

  const fetched = await fetchInstagramPageIdentity({ pageId, accessToken: token, signal })
  if (!fetched.ok) return false

  const identity = identityPersistPayload({
    platform: 'instagram',
    providerDisplayName: fetched.pageName,
    providerUsername: fetched.igUsername,
    pageId,
    existingDisplayName: row.displayName,
  })

  const db = prisma as any
  await db.socialAccount.update({
    where: { id: row.id },
    data: {
      providerDisplayName: identity.providerDisplayName,
      providerUsername: identity.providerUsername,
      pageId: identity.pageId,
      displayName: identity.displayName,
    },
  })
  return true
}

/**
 * Lazy Graph identity backfill for accounts missing provider fields.
 * Throttled ≤1/h/account via atomic tokenLastCheckedAt claim.
 * Graph jobs run concurrently (capped) and honor an optional deadline so
 * GET /api/chat/accounts cannot stall `/chats` on hung Meta.
 */
export async function refreshMissingAccountIdentities(
  rows: IdentityAccountRow[],
  options: RefreshMissingIdentitiesOptions = {},
): Promise<{ attempted: number; refreshed: number }> {
  const { signal, dispose } = startRefreshDeadline(options.timeoutMs, options.signal)
  const claimSlot = options.claimSlot ?? claimIdentityRefreshSlot
  const refreshWhatsApp = options.refreshWhatsApp ?? refreshWhatsAppIdentity
  const refreshInstagram = options.refreshInstagram ?? refreshInstagramIdentity

  try {
    if (signal?.aborted) return { attempted: 0, refreshed: 0 }

    const eligible: IdentityAccountRow[] = []
    for (const row of rows) {
      if (signal?.aborted) break
      if (!needsIdentityRefresh(row)) continue
      const claimed = await claimSlot(row.id)
      if (!claimed) continue
      eligible.push(row)
    }

    if (eligible.length === 0) return { attempted: 0, refreshed: 0 }

    const completed: boolean[] = []
    const jobs = mapLimit(eligible, IDENTITY_REFRESH_CONCURRENCY, async (row) => {
      if (signal?.aborted) {
        completed.push(false)
        return false
      }
      try {
        let ok = false
        switch (row.platform) {
          case 'whatsapp':
            ok = await refreshWhatsApp(row, signal)
            break
          case 'instagram':
            ok = await refreshInstagram(row, signal)
            break
          default:
            ok = false
            break
        }
        completed.push(ok)
        return ok
      } catch (error) {
        if (!isAbortError(error)) {
          console.warn('[social-account-identity-refresh] failed', {
            accountId: row.id,
            platform: row.platform,
            error,
          })
        }
        completed.push(false)
        return false
      }
    })

    if (signal) {
      await Promise.race([jobs, waitForAbort(signal)])
    } else {
      await jobs
    }

    return {
      attempted: eligible.length,
      refreshed: completed.filter(Boolean).length,
    }
  } finally {
    dispose()
  }
}

export const IDENTITY_REFRESH_THROTTLE_MS_FOR_TESTS = IDENTITY_REFRESH_THROTTLE_MS
