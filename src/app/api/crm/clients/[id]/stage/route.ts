import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { getClientStage, setClientStageManually } from '@/lib/crm-client-stage-server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const client = await prisma.client.findFirst({ where: { id, tenantId: auth.tenantId }, select: { id: true } })
  if (!client) return NextResponse.json({ success: false, error: 'Cliente no encontrado' }, { status: 404 })
  const stage = await getClientStage(auth.tenantId, client.id, auth.userId)
  return NextResponse.json({ success: true, stage }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Manual stage: sticks until new evidence (orders, payment, guía) moves the client again. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const json = (await request.json().catch(() => null)) as { stageKey?: unknown } | null
  if (typeof json?.stageKey !== 'string') return NextResponse.json({ success: false, error: 'Falta la etapa' }, { status: 400 })
  const result = await setClientStageManually({ tenantId: auth.tenantId, clientId: id, stageKey: json.stageKey, userId: auth.userId })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, stage: result.stage })
}
