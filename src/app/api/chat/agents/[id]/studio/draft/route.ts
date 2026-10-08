/**
 * GET/POST /api/chat/agents/[id]/studio/draft — the agent's latest "Crear desde fuentes" draft / start a new one.
 * POST { sourceIds?: string[] } starts one AI extraction (background, cost-capped, 10 per business per day);
 * POST { action: 'discard', draftId } throws a ready/failed draft away (back to sources).
 * GET adds the inventory names of matched products so the owner can confirm each match.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { discardDraft, latestDraft, startProfileExtraction } from '@/lib/agent-studio/extract'
import { studioFail, studioGuard } from '@/lib/agent-studio/route-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const g = await studioGuard(request, id, 'read')
  if (!g.ok) return g.response
  try {
    const draft = await latestDraft(g.ctx.tenantId, g.ctx.agent.id)
    // Inventory the owner can pick from when a product had no automatic match (this business only).
    const inventory =
      draft?.status === 'ready'
        ? await prisma.inventoryItem.findMany({
            where: { tenantId: g.ctx.tenantId, isActive: true },
            select: { id: true, name: true, sku: true, category: true, sellingPrice: true, currentStock: true },
            orderBy: { name: 'asc' },
            take: 400,
          })
        : []
    return NextResponse.json(
      {
        success: true,
        draft,
        inventory: inventory.map((i) => ({ ...i, sellingPrice: Number(i.sellingPrice), currentStock: Number(i.currentStock) })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return studioFail('draft GET', error)
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const g = await studioGuard(request, id, 'heavy')
  if (!g.ok) return g.response
  try {
    const body = (await request.json().catch(() => ({}))) as { sourceIds?: unknown; action?: unknown; draftId?: unknown }
    if (body.action === 'discard') {
      const ok = typeof body.draftId === 'string' && (await discardDraft(g.ctx.tenantId, g.ctx.agent.id, body.draftId))
      return ok
        ? NextResponse.json({ success: true })
        : NextResponse.json({ success: false, error: 'Ese borrador ya no se puede descartar.' }, { status: 409 })
    }
    const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.filter((x): x is string => typeof x === 'string').slice(0, 30) : undefined
    const draft = await startProfileExtraction({ tenantId: g.ctx.tenantId, agentId: g.ctx.agent.id, userId: g.ctx.userId, sourceIds })
    return NextResponse.json({ success: true, draft })
  } catch (error) {
    return studioFail('draft POST', error)
  }
}
