/**
 * Instagram as a source for "Crear desde fuentes": the bio and recent post captions of one of THIS business's
 * connected Instagram accounts (any of them, chosen by the owner). Read-only Graph calls with the stored token.
 * Photos are only taken from Meta CDN hosts. Captions are DATA for the extractor, never instructions.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { isAllowedMetaMediaDownloadUrl } from '@/lib/chat-media'

export class InstagramSourceError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'InstagramSourceError'
  }
}

export type InstagramProfile = {
  username: string | null
  name: string | null
  biography: string | null
  website: string | null
  posts: Array<{ caption: string; permalink: string | null; imageUrl: string | null; at: string | null }>
}

async function graphGet(path: string, token: string): Promise<Record<string, unknown>> {
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(path), token)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new InstagramSourceError(`graph_${res.status}`)
  return json
}

export async function fetchInstagramProfile(tenantId: string, socialAccountId: string): Promise<InstagramProfile> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: socialAccountId, tenantId },
    select: { platform: true, accountId: true, accessToken: true },
  })
  if (!account) throw new InstagramSourceError('not_found')
  if ((account.platform || '').toLowerCase() !== 'instagram') throw new InstagramSourceError('not_instagram')
  if (!account.accessToken) throw new InstagramSourceError('no_token')
  const token = decryptSocialAccessToken(account.accessToken)
  if (!token) throw new InstagramSourceError('no_token')
  const igId = encodeURIComponent(account.accountId)

  const profile = await graphGet(`${igId}?fields=biography,name,username,website`, token)
  const posts: InstagramProfile['posts'] = []
  let next: string | null = `${igId}/media?fields=caption,permalink,timestamp,media_type,media_url&limit=25`
  for (let page = 0; page < 2 && next; page += 1) {
    const data = await graphGet(next, token)
    for (const item of (Array.isArray(data.data) ? data.data : []) as Array<Record<string, unknown>>) {
      const caption = typeof item.caption === 'string' ? item.caption.slice(0, 2_000) : ''
      const mediaUrl = typeof item.media_url === 'string' ? item.media_url : null
      posts.push({
        caption,
        permalink: typeof item.permalink === 'string' ? item.permalink : null,
        imageUrl: item.media_type === 'IMAGE' && mediaUrl && isAllowedMetaMediaDownloadUrl(mediaUrl) ? mediaUrl : null,
        at: typeof item.timestamp === 'string' ? item.timestamp : null,
      })
    }
    // Follow Graph pagination only through our own path builder (never an arbitrary URL).
    const after = (data.paging as { cursors?: { after?: string } } | undefined)?.cursors?.after
    next = after && posts.length < 50 ? `${igId}/media?fields=caption,permalink,timestamp,media_type,media_url&limit=25&after=${encodeURIComponent(after)}` : null
  }
  const s = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  return {
    username: s(profile.username, 60),
    name: s(profile.name, 120),
    biography: s(profile.biography, 600),
    website: s(profile.website, 300),
    posts: posts.slice(0, 50),
  }
}

/** Plain text for the extractor (captions only; photos are handled separately). */
export function instagramProfileText(p: InstagramProfile): string {
  const lines = [
    p.name ? `Nombre: ${p.name}` : '',
    p.username ? `Usuario: @${p.username}` : '',
    p.website ? `Sitio: ${p.website}` : '',
    p.biography ? `Bio: ${p.biography}` : '',
    ...p.posts.filter((x) => x.caption).map((x, i) => `Publicación ${i + 1}: ${x.caption}`),
  ]
  return lines.filter(Boolean).join('\n').slice(0, 60_000)
}
