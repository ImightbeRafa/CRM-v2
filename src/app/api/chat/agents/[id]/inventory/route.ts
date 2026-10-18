/**
 * GET/PUT /api/chat/agents/[id]/inventory — which products this agent may quote (SQL 046).
 * PATCH — the out-of-stock switch of ONE of those products (SQL 055; store-level: every agent of the store sees it).
 * tenantId from the session; the agent and every product must belong to it; PUT/PATCH need update_config and are audited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
import {
  InventoryMapEmptyError,
  InventoryMapNotReadyError,
  listMappedInventory,
  loadMappedInventoryIds,
  setMappedInventory,
} from '@/lib/soft-ai/agent-inventory-map'
import { recordAgentVersionSnapshot } from '@/lib/soft-ai/agent-improvement'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { AvailabilityNotReadyError, availabilityReady, loadAvailability, saveAvailability } from '@/lib/soft-ai/product-availability'
import { backDateExpired, backText, checkBackDate, sanitizeBackNote, staleBackIds, tracksStock } from '@/lib/soft-ai/product-availability-core'

const inventoryRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'chat-agent-inventory' })
const availabilityRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 60, identifier: 'chat-agent-availability' })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownedAgent(tenantId: string, id: string) {
  return prisma.chatAgent.findFirst({
    where: { id, tenantId },
    select: { id: true, name: true, status: true, enabledTools: true },
  })
}

/** Out-of-stock switch (SQL 055) per mapped product: the owner's switch, the stock-0 rule and the "vuelve aprox.". */
async function withAvailability(tenantId: string, result: Awaited<ReturnType<typeof listMappedInventory>>) {
  const ready = result.available && (await availabilityReady())
  const rows = ready ? await loadAvailability(tenantId, result.items.map((i) => i.id)) : new Map()
  const tracks = tracksStock(result.items.filter((i) => i.isActive))
  // A spent "vuelve aprox." (back on sale, no manual switch) is not shown; the agent's next turn clears it (no write on GET).
  const stale = new Set(staleBackIds(result.items, rows))
  return {
    ...result,
    availabilityReady: ready,
    tracksStock: tracks,
    items: result.items.map((i) => {
      const raw = rows.get(i.id) ?? null
      const row = raw && stale.has(i.id) ? { ...raw, backDate: null, backNote: null } : raw
      return {
        ...i,
        soldOut: row?.soldOut === true,
        autoSoldOut: tracks && i.isActive && i.currentStock <= 0,
        backDate: row?.backDate ?? null,
        backNote: row?.backNote ?? null,
        backExpired: Boolean(row?.backDate && backDateExpired(row.backDate)),
        backText: backText(row),
      }
    }),
  }
}

const availabilityBody = z
  .object({
    itemId: z.string().min(1).max(80),
    soldOut: z.boolean(),
    backDate: z.string().max(10).nullable().optional(),
    backNote: z.string().max(200).nullable().optional(),
  })
  .strict()

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    if (!(await ownedAgent(auth.tenantId, id))) {
      return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    }
    const result = await withAvailability(auth.tenantId, await listMappedInventory(auth.tenantId, id))
    // ?catalog=1: this business's active products grouped by category, to pick a whole group (all sizes) at once.
    if (request.nextUrl.searchParams.get('catalog') === '1') {
      const all = await prisma.inventoryItem.findMany({
        where: { tenantId: auth.tenantId, isActive: true },
        select: { id: true, name: true, sku: true, category: true, sellingPrice: true, currentStock: true },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        take: 400,
      })
      const groups = new Map<string, Array<{ id: string; name: string; sku: string | null; sellingPrice: number; currentStock: number }>>()
      for (const i of all) {
        const key = (i.category || '').trim() || 'Sin categoría'
        const list = groups.get(key) ?? []
        list.push({ id: i.id, name: i.name, sku: i.sku, sellingPrice: Number(i.sellingPrice), currentStock: Number(i.currentStock) })
        groups.set(key, list)
      }
      return NextResponse.json(
        { success: true, ...result, catalog: [...groups.entries()].map(([category, items]) => ({ category, items })) },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
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
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await inventoryRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id } = await context.params
    const agent = await ownedAgent(auth.tenantId, id)
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    const body = (await request.json().catch(() => null)) as { itemIds?: unknown } | null
    if (!body || !Array.isArray(body.itemIds)) {
      return NextResponse.json({ success: false, error: 'Falta la lista de productos' }, { status: 400 })
    }
    // Same list as today: nothing to save, no new version, no snapshot row (no growth from repeated saves).
    const requested = new Set(body.itemIds.filter((v): v is string => typeof v === 'string'))
    const current = await loadMappedInventoryIds(auth.tenantId, agent.id)
    if (current !== null && current.length === requested.size && current.every((itemId) => requested.has(itemId))) {
      return NextResponse.json({ success: true, stored: current.length, unchanged: true })
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
    // A change of the product list changes what the agent can quote: it is a new version with its own snapshot.
    const bumped = await prisma.chatAgent.update({
      where: { id: agent.id },
      data: { version: { increment: 1 }, updatedBy: auth.userId },
    })
    // The list is saved: a snapshot hiccup must not skip the audit row or return a 500.
    let mappedNow: string[] | null = null
    try {
      mappedNow = await loadMappedInventoryIds(auth.tenantId, agent.id)
      await recordAgentVersionSnapshot({
        tenantId: auth.tenantId,
        agentId: agent.id,
        version: bumped.version,
        agent: { ...bumped, inventoryItemIds: mappedNow },
        actorUserId: auth.userId,
      })
    } catch (error) {
      console.error('[chat/agents/:id/inventory] snapshot skipped', error instanceof Error ? error.name : 'unknown')
    }
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatAgent',
      entityId: agent.id,
      entityName: agent.name,
      description: `Productos del agente: ${stored}`,
      newValues: { inventoryItemCount: stored, inventoryItemIds: (mappedNow ?? []).slice(0, 50), version: bumped.version },
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await availabilityRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id } = await context.params
    const agent = await ownedAgent(auth.tenantId, id)
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    const parsed = availabilityBody.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    const body = parsed.data
    const backDate = checkBackDate(body.backDate)
    if (backDate === 'invalid') {
      return NextResponse.json({ success: false, error: 'La fecha de regreso tiene que ser de hoy a 6 meses.' }, { status: 400 })
    }
    // Numbers are removed from the note (it is shown to the agent): say so instead of saving "en semanas" (Verifier r1 #5).
    if (!backDate && body.backNote && /\p{N}/u.test(body.backNote)) {
      return NextResponse.json({ success: false, error: 'La nota no lleva números: para una fecha usá el calendario.' }, { status: 400 })
    }
    // Only a product of THIS agent's list (fail closed: an agent with no list sells nothing) and of this business.
    const mapped = await loadMappedInventoryIds(auth.tenantId, agent.id)
    if (!mapped || !mapped.includes(body.itemId)) {
      return NextResponse.json({ success: false, error: 'Ese producto no está en la lista de este agente.' }, { status: 404 })
    }
    const item = await prisma.inventoryItem.findFirst({
      where: { id: body.itemId, tenantId: auth.tenantId },
      select: { id: true, name: true },
    })
    if (!item) return NextResponse.json({ success: false, error: 'Producto no encontrado' }, { status: 404 })
    // A date wins over the note (one "vuelve aprox." at a time); the note is cleaned again on every read.
    const backNote = backDate ? null : sanitizeBackNote(body.backNote)
    const before = await saveAvailability({
      tenantId: auth.tenantId,
      inventoryItemId: item.id,
      soldOut: body.soldOut,
      backDate,
      backNote,
      actorUserId: auth.userId,
    })
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatAgent',
      entityId: agent.id,
      entityName: agent.name,
      description: `${body.soldOut ? 'Agotado' : 'Disponible'}: ${item.name.slice(0, 80)}`,
      oldValues: { inventoryItemId: item.id, soldOut: before?.soldOut ?? false, backDate: before?.backDate ?? null, backNote: before?.backNote ?? null },
      newValues: { inventoryItemId: item.id, soldOut: body.soldOut, backDate, backNote, agentId: agent.id },
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, soldOut: body.soldOut, backDate, backNote })
  } catch (error) {
    if (error instanceof AvailabilityNotReadyError) {
      return NextResponse.json({ success: false, error: 'El botón "Agotado" se activa con la próxima actualización.' }, { status: 503 })
    }
    console.error('[chat/agents/inventory PATCH]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar' }, { status: 500 })
  }
}
