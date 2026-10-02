/**
 * GET/PUT /api/chat/agents/[id]/inventory — which products this agent may quote (SQL 046).
 * tenantId from the session; the agent and every product must belong to it; PUT needs update_config and is audited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
import {
  InventoryMapEmptyError,
  InventoryMapNotReadyError,
  listMappedInventory,
  setMappedInventory,
} from '@/lib/soft-ai/agent-inventory-map'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownedAgent(tenantId: string, id: string) {
  return prisma.chatAgent.findFirst({
    where: { id, tenantId },
    select: { id: true, name: true, status: true, enabledTools: true },
  })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    if (!(await ownedAgent(auth.tenantId, id))) {
      return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    }
    const result = await listMappedInventory(auth.tenantId, id)
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[chat/agents/inventory GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const agent = await ownedAgent(auth.tenantId, id)
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    const body = (await request.json().catch(() => null)) as { itemIds?: unknown } | null
    if (!body || !Array.isArray(body.itemIds)) {
      return NextResponse.json({ success: false, error: 'Falta la lista de productos' }, { status: 400 })
    }
    // A live agent with the product search on can't be left without a list (it would quote the whole catalog);
    // checked on the list AFTER every id was validated against the business.
    const requireNonEmpty = agent.status === 'live' && agent.enabledTools.includes('search_inventory')
    const stored = await setMappedInventory({
      requireNonEmpty,
      tenantId: auth.tenantId,
      agentId: agent.id,
      itemIds: body.itemIds.filter((v): v is string => typeof v === 'string'),
      actorUserId: auth.userId,
    })
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatAgent',
      entityId: agent.id,
      entityName: agent.name,
      description: `Productos del agente: ${stored}`,
      newValues: { inventoryItemCount: stored },
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, stored })
  } catch (error) {
    if (error instanceof InventoryMapEmptyError) {
      return NextResponse.json(
        { success: false, error: 'Este agente está activo: dejá al menos un producto o pasalo a borrador primero.' },
        { status: 409 },
      )
    }
    if (error instanceof InventoryMapNotReadyError) {
      return NextResponse.json(
        { success: false, error: 'Los productos por agente todavía no están disponibles.' },
        { status: 503 },
      )
    }
    console.error('[chat/agents/inventory PUT]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar' }, { status: 500 })
  }
}
