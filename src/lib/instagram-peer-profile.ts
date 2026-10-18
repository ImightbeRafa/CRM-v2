import 'server-only'
/**
 * Instagram customer profile (Rafael 2026-10-18): the inbox shows "Name (@username)" and the customer's photo
 * instead of "Instagram User 076336".
 *
 * - Graph User Profile API: GET /{IGSID}?fields=name,username,profile_pic with the line's Page token (decrypted
 *   server-side exactly like the send path; it never leaves this file).
 * - The photo is downloaded once (Meta CDN hosts only, every redirect re-checked, size-capped), re-encoded to a
 *   small WebP and kept in private chat storage at `chat-media/<tenant>/avatars/<conversation>`; the browser
 *   only ever sees `/api/chat/conversations/<id>/avatar`. The expiring CDN link is never stored or sent.
 * - Webhook: fire-and-forget after the message is stored, hard timeout, every error swallowed (the current
 *   label stays). Cron: a few conversations per minute that were never looked up (or not for 30 days).
 */
import { prisma } from '@/lib/db'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { downloadMetaMediaWithCap, isAllowedMetaMediaDownloadUrl } from '@/lib/chat-media'
import { cleanProfileUsername, hasStoredPeerAvatar, isPlaceholderPeerName, peerAvatarStoragePath } from '@/lib/chat-peer-display'
import { chatStoragePut, chatStorageRemove } from '@/lib/chat-storage'
import { makeChatThumbnail } from '@/lib/chat-media-thumb'

export const PEER_PROFILE_TIMEOUT_MS = 8_000
/** Webhook path: look again at most once a week per conversation (also after a failed lookup). */
export const PEER_PROFILE_RECHECK_MS = 7 * 24 * 60 * 60 * 1000
/** Cron path: conversations never looked up, or active ones not looked up for 30 days. */
export const PEER_PROFILE_BACKFILL_STALE_MS = 30 * 24 * 60 * 60 * 1000
/** A failed lookup (Meta error / timeout) is retried after this long. */
export const PEER_PROFILE_RETRY_FAILED_MS = 6 * 60 * 60 * 1000
/** This page / account is throttled by Meta: that line is paused this long (webhook + cron). */
export const PEER_PROFILE_RETRY_PAGE_LIMIT_MS = 15 * 60 * 1000
export const PEER_AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_WIDTH = 128

const IGSID = /^\d{5,32}$/

/** Display text from Meta: no control / bidi characters, single spaces, capped. */
export function cleanProfileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw
    .normalize('NFKC')
    // Every control / format character (zero-width, bidi, soft hyphen, word joiners, tag characters).
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Cut by code points so an emoji is never split in half.
  const capped = Array.from(v).slice(0, 80).join('').trim()
  return capped || null
}

export type InstagramPeerProfile = { name: string | null; username: string | null; profilePic: string | null }

type FetchLike = typeof fetch

/**
 * Graph call. `rateLimited`: app-wide limit (HTTP 429 / code 4) → the cron stops this run. `pageLimited`: this
 * line's page / account is throttled (17, 32, 613) → only this line waits; other tenants keep going.
 */
export async function fetchInstagramUserProfile(opts: {
  igsid: string
  accessToken: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<{ ok: true; profile: InstagramPeerProfile } | { ok: false; rateLimited: boolean; pageLimited?: boolean }> {
  if (!IGSID.test(opts.igsid)) return { ok: false, rateLimited: false }
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${opts.igsid}?fields=name,username,profile_pic`),
    opts.accessToken,
  )
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? PEER_PROFILE_TIMEOUT_MS),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok) {
      const code = Number(data?.error?.code)
      const rateLimited = res.status === 429 || code === 4
      return { ok: false, rateLimited, pageLimited: !rateLimited && [17, 32, 613].includes(code) }
    }
    const profilePic = typeof data.profile_pic === 'string' && isAllowedMetaMediaDownloadUrl(data.profile_pic) ? data.profile_pic : null
    return {
      ok: true,
      profile: { name: cleanProfileName(data.name), username: cleanProfileUsername(data.username), profilePic },
    }
  } catch {
    return { ok: false, rateLimited: false }
  }
}

/** Download (Meta CDN only, capped) → 128px WebP. Null when it isn't a real photo or anything fails. */
export async function downloadPeerAvatar(opts: { url: string; fetchImpl?: FetchLike }): Promise<Buffer | null> {
  if (!isAllowedMetaMediaDownloadUrl(opts.url)) return null
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('avatar_timeout')), PEER_PROFILE_TIMEOUT_MS)
    })
    const download = downloadMetaMediaWithCap({
      url: opts.url,
      accessToken: '',
      sendAuth: false,
      strictHosts: true,
      maxBytes: PEER_AVATAR_MAX_BYTES,
      fetchImpl: opts.fetchImpl,
    })
    download.catch(() => undefined)
    const { bytes } = await Promise.race([download, deadline]).finally(() => clearTimeout(timer))
    // Re-encoding drops anything that isn't a JPG / PNG / WebP photo (makeChatThumbnail checks the signature).
    return await makeChatThumbnail(bytes, AVATAR_WIDTH)
  } catch {
    return null
  }
}

type Deps = {
  db?: any
  fetchImpl?: FetchLike
  putAvatar?: (pathname: string, bytes: Buffer) => Promise<unknown>
  removeAvatar?: (pathname: string) => Promise<unknown>
  now?: () => Date
}

export type EnrichResult =
  | { status: 'updated'; name: boolean; username: boolean; avatar: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; rateLimited: boolean; pageLimited?: boolean }

/**
 * Look up one Instagram conversation's customer and save name / @username / photo. Tenant-scoped (the row is
 * read by id AND tenant). Never overwrites a real name someone already has on the chat.
 */
export async function enrichInstagramPeerProfile(
  args: { tenantId: string; conversationId: string; recheckMs?: number },
  deps: Deps = {},
): Promise<EnrichResult> {
  const db = deps.db ?? (prisma as any)
  const now = deps.now?.() ?? new Date()
  const conv = await db.chatConversation.findFirst({
    where: { id: args.conversationId, tenantId: args.tenantId },
    select: {
      id: true,
      tenantId: true,
      socialAccountId: true,
      peerId: true,
      peerName: true,
      peerUsername: true,
      peerAvatarUrl: true,
      peerProfileCheckedAt: true,
      socialAccount: {
        select: { tenantId: true, platform: true, accessToken: true, isActive: true, disconnectedAt: true, tokenStatus: true },
      },
    },
  })
  if (!conv) return { status: 'skipped', reason: 'not_found' }
  const account = conv.socialAccount
  if (account?.platform !== 'instagram') return { status: 'skipped', reason: 'not_instagram' }
  // Second safeguard: only ever use a token of a line that belongs to the chat's own tenant.
  if (account.tenantId !== conv.tenantId) return { status: 'skipped', reason: 'tenant_mismatch' }
  const recheckMs = args.recheckMs ?? PEER_PROFILE_RECHECK_MS
  if (conv.peerProfileCheckedAt && now.getTime() - new Date(conv.peerProfileCheckedAt).getTime() < recheckMs) {
    return { status: 'skipped', reason: 'recent' }
  }
  if (conv.socialAccountId && isLineThrottled(conv.socialAccountId)) return { status: 'skipped', reason: 'line_throttled' }
  // Claim the lookup first (compare-and-set on the old timestamp): concurrent webhooks / cron runs for the same
  // chat don't both call Meta, and a failure (or a line without a usable token) still waits before the next try.
  const claim = await db.chatConversation.updateMany({
    where: { id: conv.id, tenantId: conv.tenantId, peerProfileCheckedAt: conv.peerProfileCheckedAt ?? null },
    data: { peerProfileCheckedAt: now },
  })
  if (!claim?.count) return { status: 'skipped', reason: 'claimed_elsewhere' }

  const tokenStatus = String(account.tokenStatus || '').toLowerCase()
  if (account.isActive === false || account.disconnectedAt || tokenStatus === 'revoked' || tokenStatus === 'expired') {
    return { status: 'skipped', reason: 'line_inactive' }
  }
  const accessToken = decryptSocialAccessToken(account.accessToken)
  if (!accessToken) return { status: 'skipped', reason: 'no_token' }

  const fetched = await fetchInstagramUserProfile({ igsid: conv.peerId, accessToken, fetchImpl: deps.fetchImpl })
  if (!fetched.ok && fetched.rateLimited) appThrottledUntil = Date.now() + PEER_PROFILE_APP_BACKOFF_MS
  if (!fetched.ok && fetched.pageLimited && conv.socialAccountId) throttleLine(conv.socialAccountId)
  if (!fetched.ok) {
    // Rate limit (whole app, or this page): give the claim back, so the chat stays in the cron queue; the in-memory
    // 15 min pause (app-wide, or this line only) keeps both paths off Meta meanwhile. Other failures: retry in ~6 h
    // on the path that tried (webhook 7-day window / cron 30-day window).
    const retryAt =
      fetched.rateLimited || fetched.pageLimited
        ? (conv.peerProfileCheckedAt ?? null)
        : new Date(now.getTime() - recheckMs + PEER_PROFILE_RETRY_FAILED_MS)
    await db.chatConversation
      .updateMany({ where: { id: conv.id, tenantId: conv.tenantId }, data: { peerProfileCheckedAt: retryAt } })
      .catch(() => undefined)
    return { status: 'failed', rateLimited: fetched.rateLimited, pageLimited: Boolean(fetched.pageLimited) }
  }
  const { profile } = fetched

  const data: Record<string, unknown> = {}
  const realName = profile.name || (profile.username ? `@${profile.username}` : null)
  // Ours to replace: the webhook placeholder, or the bare "@username" we saved before Meta had a name.
  const ownName = isPlaceholderPeerName(conv.peerName) || (conv.peerUsername && conv.peerName === `@${conv.peerUsername}`)
  if (realName && ownName && realName !== conv.peerName) data.peerName = realName
  if (profile.username && profile.username !== conv.peerUsername) data.peerUsername = profile.username

  let avatar = false
  if (!profile.profilePic && hasStoredPeerAvatar(conv)) {
    // The customer removed (or hid) their photo: delete our copy too; initials come back.
    try {
      await (deps.removeAvatar ?? ((p: string) => chatStorageRemove([p])))(peerAvatarStoragePath(conv.tenantId, conv.id))
      data.peerAvatarUrl = null
    } catch {
      // Storage unreachable: keep the path so the next lookup tries again.
    }
  }
  if (profile.profilePic) {
    const bytes = await downloadPeerAvatar({ url: profile.profilePic, fetchImpl: deps.fetchImpl })
    if (bytes) {
      const pathname = peerAvatarStoragePath(conv.tenantId, conv.id)
      const put = deps.putAvatar ?? ((p: string, b: Buffer) => chatStoragePut(p, b, 'image/webp', { overwrite: true }))
      try {
        await put(pathname, bytes)
        data.peerAvatarUrl = pathname
        // New ?v= for the photo route (the claim's stamp was already seen while the old photo was stored).
        data.peerProfileCheckedAt = new Date(Math.max(Date.now(), now.getTime() + 1))
        avatar = true
      } catch {
        // Storage down / not configured: initials stay.
      }
    }
  }

  if (Object.keys(data).length) {
    await db.chatConversation.updateMany({ where: { id: conv.id, tenantId: conv.tenantId }, data })
  }
  return { status: 'updated', name: 'peerName' in data, username: 'peerUsername' in data, avatar }
}

const inFlight = new Set<string>()
/** Meta said the whole app is rate limited (429 / code 4): no lookups at all until then (webhook and cron). */
let appThrottledUntil = 0
export const PEER_PROFILE_APP_BACKOFF_MS = 15 * 60 * 1000
export function isPeerProfileAppThrottled(): boolean {
  return Date.now() < appThrottledUntil
}
/** Lines (SocialAccount ids) whose page / account Meta is throttling: skipped until the time stored here. */
const lineThrottledUntil = new Map<string, number>()
function throttleLine(socialAccountId: string): void {
  if (lineThrottledUntil.size >= 500) lineThrottledUntil.clear()
  lineThrottledUntil.set(socialAccountId, Date.now() + PEER_PROFILE_RETRY_PAGE_LIMIT_MS)
}
export function isLineThrottled(socialAccountId: string): boolean {
  const until = lineThrottledUntil.get(socialAccountId)
  if (!until) return false
  if (Date.now() < until) return true
  lineThrottledUntil.delete(socialAccountId)
  return false
}
function throttledLineIds(): string[] {
  return [...lineThrottledUntil.keys()].filter((id) => isLineThrottled(id))
}

/**
 * Webhook hook: never awaited, never throws, never delays the 200 or the agent. A hard timeout bounds the work.
 */
export function scheduleInstagramPeerProfile(args: { tenantId: string; conversationId: string; platform: string }): void {
  if (args.platform !== 'instagram' || !args.tenantId || !args.conversationId) return
  if (inFlight.has(args.conversationId) || inFlight.size > 50 || isPeerProfileAppThrottled()) return
  inFlight.add(args.conversationId)
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 20_000).unref?.())
  void Promise.race([enrichInstagramPeerProfile(args).then(() => undefined), timeout])
    .catch(() => undefined)
    .finally(() => inFlight.delete(args.conversationId))
}

/** Cron: a few Instagram chats per run (never looked up, or active and not looked up for 30 days). */
export async function backfillInstagramPeerProfiles(
  opts: { limit?: number; budgetMs?: number } = {},
  deps: Deps = {},
): Promise<{ checked: number; updated: number; failed: number; rateLimited: boolean }> {
  const db = deps.db ?? (prisma as any)
  const started = Date.now()
  const now = deps.now?.() ?? new Date()
  const stale = new Date(now.getTime() - PEER_PROFILE_BACKFILL_STALE_MS)
  if (isPeerProfileAppThrottled()) return { checked: 0, updated: 0, failed: 0, rateLimited: true }
  const skipLines = throttledLineIds()
  const rows: Array<{ id: string; tenantId: string; socialAccountId?: string }> = await db.chatConversation.findMany({
    where: {
      // Throttled lines leave the query (they would head the queue every minute and starve other tenants).
      ...(skipLines.length ? { socialAccountId: { notIn: skipLines } } : {}),
      socialAccount: { platform: 'instagram', isActive: true, disconnectedAt: null },
      OR: [
        { peerProfileCheckedAt: null },
        { peerProfileCheckedAt: { lt: stale }, lastMessageAt: { gt: stale } },
      ],
    },
    select: { id: true, tenantId: true, socialAccountId: true },
    orderBy: [{ lastMessageAt: 'desc' }],
    take: Math.min(Math.max(opts.limit ?? 5, 1), 20),
  })
  const summary = { checked: 0, updated: 0, failed: 0, rateLimited: false }
  for (const row of rows) {
    if (Date.now() - started > (opts.budgetMs ?? 8_000)) break
    if (row.socialAccountId && isLineThrottled(row.socialAccountId)) continue
    summary.checked += 1
    const result = await enrichInstagramPeerProfile(
      { tenantId: row.tenantId, conversationId: row.id, recheckMs: PEER_PROFILE_BACKFILL_STALE_MS },
      deps,
    ).catch(() => ({ status: 'failed', rateLimited: false }) as EnrichResult)
    if (result.status === 'updated') summary.updated += 1
    if (result.status === 'failed') {
      summary.failed += 1
      if (result.rateLimited) {
        summary.rateLimited = true
        break
      }
    }
  }
  return summary
}
