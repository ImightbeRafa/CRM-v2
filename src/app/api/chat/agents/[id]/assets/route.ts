/**
 * GET /api/chat/agents/[id]/assets — images this agent can send with its replies + which reply sends which
 * (view_config; tenant + agent).
 */
import { NextRequest, NextResponse } from 'next/server'
import { studioGuard, studioFail } from '@/lib/agent-studio/route-guard'
import { agentAssetsReady, listAgentAssets, loadReplyAssets } from '@/lib/soft-ai/agent-assets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const g = await studioGuard(request, id, 'read')
  if (!g.ok) return g.response
  try {
    const [available, assets, byReply] = await Promise.all([
      agentAssetsReady(),
      listAgentAssets(g.ctx.tenantId, g.ctx.agent.id),
      loadReplyAssets(g.ctx.tenantId, g.ctx.agent.id),
    ])
    // Which images each saved reply sends (reply id → image ids, in order).
    const links = Object.fromEntries([...byReply].map(([shortcutId, list]) => [shortcutId, list.map((a) => a.id)]))
    return NextResponse.json({ success: true, available, assets, links }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return studioFail('assets GET', error)
  }
}
