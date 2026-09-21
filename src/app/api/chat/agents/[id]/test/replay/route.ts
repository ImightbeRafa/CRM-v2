/**
 * POST /api/chat/agents/[id]/test/replay — fixture v2 report, no live token cap.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { parseBrandFactsSafe, parseReplyStyleSafe } from '@/lib/soft-ai/brand-facts'
import { canSharePaymentFacts } from '@/lib/soft-ai/brand-facts'
import { replayFixtures } from '@/lib/soft-ai/agent-replay'
import { listRuntimeShortcuts } from '@/lib/soft-ai/shortcut-repository'
import { loadDailyTestTokens } from '@/lib/soft-ai/agent-claim-gates'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { CHAT_AGENT_LAYER_V1_FLAG } from '@/lib/soft-ai/agent-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const agent = await prisma.chatAgent.findFirst({
      where: { id, tenantId: auth.tenantId },
    })
    if (!agent) {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    const facts = parseBrandFactsSafe(agent.brandFacts)
    const shortcuts = await listRuntimeShortcuts(auth.tenantId, agent.id)
    const report = replayFixtures({
      brandFacts: facts,
      replyStyle: parseReplyStyleSafe(agent.replyStyle),
      shortcuts,
      sharePaymentFacts: canSharePaymentFacts(facts),
    })
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: { tenantId: auth.tenantId, scope: auth.tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
      select: { config: true },
    })
    const config = parseChatAgentLayerConfig(flag?.config)
    const testTokens = await loadDailyTestTokens(auth.tenantId)
    return NextResponse.json({
      success: true,
      ...report,
      tokenAccounting: 'testDailyTokenCap',
      testTokensUsed: testTokens,
      testDailyTokenCap: config.testDailyTokenCap,
    })
  } catch (error) {
    console.error('[agent test replay]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}
