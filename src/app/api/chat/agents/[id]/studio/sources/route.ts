/**
 * GET/POST /api/chat/agents/[id]/studio/sources — the business's own sources for "Crear desde fuentes".
 * POST { kind: 'text', label?, text } | { kind: 'url', url } | { kind: 'instagram', socialAccountId }
 * Websites are read SSRF-safe (same site, ≤20 pages); Instagram only from this business's connected accounts.
 * GET also lists the business's Instagram accounts to pick from. Writes: update_config + same-origin + limits.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { addSource, assertCanAddUpload, listSources, requireStudioReady } from '@/lib/agent-studio/source-store'
import { crawlSite } from '@/lib/agent-studio/web-crawl'
import { validateUrl } from '@/lib/agent-studio/safe-fetch'
import { crawlToText } from '@/lib/agent-studio/source-text'
import { fetchInstagramProfile, instagramProfileText } from '@/lib/agent-studio/instagram-source'
import { studioFail, studioGuard } from '@/lib/agent-studio/route-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

const MAX_PASTE = 60_000

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const g = await studioGuard(request, id, 'read')
  if (!g.ok) return g.response
  try {
    const [sources, instagram] = await Promise.all([
      listSources(g.ctx.tenantId, g.ctx.agent.id),
      prisma.socialAccount.findMany({
        where: { tenantId: g.ctx.tenantId, platform: { in: ['instagram', 'INSTAGRAM'] }, isActive: true },
        select: { id: true, displayName: true, providerUsername: true },
        take: 20,
      }),
    ])
    return NextResponse.json(
      {
        success: true,
        sources,
        instagramAccounts: instagram.map((a) => ({ id: a.id, label: a.providerUsername ? `@${a.providerUsername}` : a.displayName || 'Instagram' })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return studioFail('sources GET', error)
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const kind = body?.kind
  const g = await studioGuard(request, id, kind === 'text' ? 'write' : 'heavy')
  if (!g.ok) return g.response
  const { tenantId, userId, agent } = g.ctx
  try {
    await requireStudioReady()
    if (kind === 'text') {
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (text.length < 20) return NextResponse.json({ success: false, error: 'Pegá un texto un poco más largo.' }, { status: 400 })
      if (text.length > MAX_PASTE) return NextResponse.json({ success: false, error: 'El texto es demasiado largo (máx. 60.000 caracteres).' }, { status: 400 })
      const label = (typeof body?.label === 'string' && body.label.trim()) || text.split('\n')[0].slice(0, 60)
      const source = await addSource({ tenantId, agentId: agent.id, kind: 'text', label, text, createdBy: userId })
      return NextResponse.json({ success: true, source })
    }
    if (kind === 'url' || kind === 'instagram') await assertCanAddUpload(tenantId, agent.id, { photo: false, bytes: 0 })
    if (kind === 'url') {
      const url = validateUrl(typeof body?.url === 'string' ? body.url.trim() : '')
      const crawl = await crawlSite(url.toString())
      if (!crawl.pages.length) return NextResponse.json({ success: false, error: 'No pudimos leer ninguna página de ese sitio.' }, { status: 400 })
      const source = await addSource({
        tenantId,
        agentId: agent.id,
        kind: 'url',
        label: url.hostname.slice(0, 200),
        url: url.toString().slice(0, 2048),
        text: crawlToText(crawl),
        meta: { pages: crawl.pages.length, urls: crawl.pages.map((p) => p.url.slice(0, 300)).slice(0, 20), products: crawl.jsonLdProducts.length },
        createdBy: userId,
      })
      return NextResponse.json({ success: true, source })
    }
    if (kind === 'instagram') {
      const socialAccountId = typeof body?.socialAccountId === 'string' ? body.socialAccountId : ''
      const profile = await fetchInstagramProfile(tenantId, socialAccountId)
      const text = instagramProfileText(profile)
      if (!text.trim()) return NextResponse.json({ success: false, error: 'Esa cuenta no tiene bio ni publicaciones con texto.' }, { status: 400 })
      const source = await addSource({
        tenantId,
        agentId: agent.id,
        kind: 'instagram',
        label: profile.username ? `@${profile.username}` : 'Instagram',
        text,
        meta: { posts: profile.posts.length, socialAccountId: socialAccountId.slice(0, 64) },
        createdBy: userId,
      })
      return NextResponse.json({ success: true, source })
    }
    return NextResponse.json({ success: false, error: 'Tipo de fuente no válido.' }, { status: 400 })
  } catch (error) {
    return studioFail('sources POST', error)
  }
}
