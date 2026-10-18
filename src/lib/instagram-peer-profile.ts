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
import { cleanProfileUsername, isPlaceholderPeerName, peerAvatarStoragePath } from '@/lib/chat-peer-display'
import { chatStoragePut } from '@/lib/chat-storage'
import { makeChatThumbnail } from '@/lib/chat-media-thumb'

export const PEER_PROFILE_TIMEOUT_MS = 8_000
/** Webhook path: look again at most once a week per conversation (also after a failed lookup). */
export const PEER_PROFILE_RECHECK_MS = 7 * 24 * 60 * 60 * 1000
/** Cron path: conversations never looked up, or active ones not looked up for 30 days. */
export const PEER_PROFILE_BACKFILL_STALE_MS = 30 * 24 * 60 * 60 * 1000
/** A failed lookup (Meta error / timeout) is retried after this long. */
export const PEER_PROFILE_RETRY_FAILED_MS = 6 * 60 * 60 * 1000
export const PEER_AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_WIDTH = 128

const IGSID = /^\d{5,32}$/

/** Display text from Meta: no control / bidi characters, single spaces, capped. */
export function cleanProfileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim()
  return v || null
}

export type InstagramPeerProfile = { name: string | null; username: string | null; profilePic: string | null }

type FetchLike = typeof fetch

/** Graph call. Returns null on any failure; `rateLimited` tells the cron to stop for this run. */
export async function fetchInstagramUserProfile(opts: {
  igsid: string
  accessToken: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<{ ok: true; profile: InstagramPeerProfile } | { ok: false; rateLimited: boolean }> {
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
      return { ok: false, rateLimited: res.status === 429 || [4, 17, 32, 613].includes(code) }
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
  now?: () => Date
}

export type EnrichResult =
  | { status: 'updated'; name: boolean; username: boolean; avatar: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; rateLimited: boolean }

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
      peerId: true,
      peerName: true,
      peerUsername: true,
      peerAvatarUrl: true,
      peerProfileCheckedAt: true,
      socialAccount: {
        select: { platform: true, accessToken: true, isActive: true, disconnectedAt: true, tokenStatus: true },
      },
    },
  })
  if (!conv) return { status: 'skipped', reason: 'not_found' }
  const account = conv.socialAccount
  if (account?.platform !== 'instagram') return { status: 'skipped', reason: 'not_instagram' }
  const recheckMs = args.recheckMs ?? PEER_PROFILE_RECHECK_MS
  if (conv.peerProfileCheckedAt && now.getTime() - new Date(conv.peerProfileCheckedAt).getTime() < recheckMs) {
    return { status: 'skipped', reason: 'recent' }
  }
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
  if (!fetched.ok) {
    // Rate limit: give the claim back (next run retries). Other failures: try again in ~6 h, not in a week.
    const retryAt = fetched.rateLimited
      ? (conv.peerProfileCheckedAt ?? null)
      : new Date(now.getTime() - recheckMs + PEER_PROFILE_RETRY_FAILED_MS)
    await db.chatConversation
      .updateMany({ where: { id: conv.id, tenantId: conv.tenantId }, data: { peerProfileCheckedAt: retryAt } })
      .catch(() => undefined)
    return { status: 'failed', rateLimited: fetched.rateLimited }
  }
  const { profile } = fetched

  const data: Record<string, unknown> = {}
  const realName = profile.name || (profile.username ? `@${profile.username}` : null)
  // Ours to replace: the webhook placeholder, or the bare "@username" we saved before Meta had a name.
  const ownName = isPlaceholderPeerName(conv.peerName) || (conv.peerUsername && conv.peerName === `@${conv.peerUsername}`)
  if (realName && ownName && realName !== conv.peerName) data.peerName = realName
  if (profile.username && profile.username !== conv.peerUsername) data.peerUsername = profile.username

  let avatar = false
  if (profile.profilePic) {
    const bytes = await downloadPeerAvatar({ url: profile.profilePic, fetchImpl: deps.fetchImpl })
    if (bytes) {
      const pathname = peerAvatarStoragePath(conv.tenantId, conv.id)
      const put = deps.putAvatar ?? ((p: string, b: Buffer) => chatStoragePut(p, b, 'image/webp', { overwrite: true }))
      try {
        await put(pathname, bytes)
        data.peerAvatarUrl = pathname
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

/**
 * Webhook hook: never awaited, never throws, never delays the 200 or the agent. A hard timeout bounds the work.
 */
export function scheduleInstagramPeerProfile(args: { tenantId: string; conversationId: string; platform: string }): void {
  if (args.platform !== 'instagram' || !args.tenantId || !args.conversationId) return
  if (inFlight.has(args.conversationId) || inFlight.size > 50) return
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
  const rows: Array<{ id: string; tenantId: string }> = await db.chatConversation.findMany({
    where: {
      socialAccount: { platform: 'instagram', isActive: true, disconnectedAt: null },
      OR: [
        { peerProfileCheckedAt: null },
        { peerProfileCheckedAt: { lt: stale }, lastMessageAt: { gt: stale } },
      ],
    },
    select: { id: true, tenantId: true },
    orderBy: [{ lastMessageAt: 'desc' }],
    take: Math.min(Math.max(opts.limit ?? 5, 1), 20),
  })
  const summary = { checked: 0, updated: 0, failed: 0, rateLimited: false }
  for (const row of rows) {
    if (Date.now() - started > (opts.budgetMs ?? 8_000)) break
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
