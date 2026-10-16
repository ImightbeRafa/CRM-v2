/**
 * GET/PUT /api/chat/agents/[id]/settings — per-agent settings (SQL 049): which orders belong to this agent's
 * business, order defaults, per-agent daily budget, and whether a default agent answers channels without one.
 * tenantId from the session; the agent must belong to it; PUT needs update_config, same-origin, and is audited.
 * GET also returns the business's distinct order stamps (salesChannel / funnel / website source) to pick from.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
import {
  AgentSettingsNotReadyError,
  loadAgentSettings,
  saveAgentSettings,
  type AgentSettingsPatch,
} from '@/lib/soft-ai/agent-settings'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { loadSalesSetup, saveSalesSetup, SalesRulesTooLargeError, SalesSetupNotReadyError } from '@/lib/soft-ai/agent-sales-setup'
import { headlineHasNumberWords, parsePromo } from '@/lib/soft-ai/promo'
import { dealProblem } from '@/lib/soft-ai/llm/output-validator'
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'
import { DEFAULT_REPLY_PACE, replyPaceSchema } from '@/lib/soft-ai/reply-pace'
import { BUSINESS_HOURS_TIMEZONE, businessHoursSchema, DEFAULT_BUSINESS_HOURS, type BusinessHours } from '@/lib/soft-ai/business-hours'
import { ownerTextProblem } from '@/lib/soft-ai/agent-tuning-core'

const settingsRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'chat-agent-settings' })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownedAgent(tenantId: string, id: string) {
  return prisma.chatAgent.findFirst({ where: { id, tenantId }, select: { id: true, name: true } })
}

type Stamps = { salesChannels: string[]; funnels: string[]; sources: string[] }
const stampCache = new Map<string, { at: number; value: Stamps }>()
const STAMP_CACHE_MS = 10 * 60_000

/** Distinct stamps already used on this business's orders (last 180 days), cached 10 min per business. */
async function knownStamps(tenantId: string): Promise<Stamps> {
  const hit = stampCache.get(tenantId)
  if (hit && Date.now() - hit.at < STAMP_CACHE_MS) return hit.value
  const value = await loadKnownStamps(tenantId)
  if (stampCache.size > 500) stampCache.clear()
  stampCache.set(tenantId, { at: Date.now(), value })
  return value
}

async function loadKnownStamps(tenantId: string): Promise<Stamps> {
  const rows = await prisma.$queryRaw<Array<{ kind: string; value: string; n: bigint }>>`
    SELECT kind, value, COUNT(*)::bigint AS n FROM (
      SELECT 'salesChannel' AS kind, NULLIF(TRIM("salesChannel"), '') AS value FROM "Order"
       WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "timestamp" > NOW() - INTERVAL '180 days'
      UNION ALL
      SELECT 'funnel', NULLIF(TRIM("funnel"), '') FROM "Order"
       WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "timestamp" > NOW() - INTERVAL '180 days'
      UNION ALL
      SELECT 'source', NULLIF(TRIM("customFields"->>'source'), '') FROM "Order"
       WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL AND "timestamp" > NOW() - INTERVAL '180 days'
    ) s WHERE value IS NOT NULL GROUP BY kind, value ORDER BY n DESC LIMIT 60`
  const out = { salesChannels: [] as string[], funnels: [] as string[], sources: [] as string[] }
  for (const r of rows) {
    const v = r.value.slice(0, 120)
    if (r.kind === 'salesChannel') out.salesChannels.push(v)
    else if (r.kind === 'funnel') out.funnels.push(v)
    else out.sources.push(v)
  }
  return out
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    if (!(await ownedAgent(auth.tenantId, id))) {
      return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    }
    const [available, settings, stamps, sales] = await Promise.all([
      isTableReady('ChatAgentSettings'),
      loadAgentSettings(auth.tenantId, id),
      knownStamps(auth.tenantId),
      loadSalesSetup(auth.tenantId, id).catch(() => null),
    ])
    return NextResponse.json(
      { success: true, available, settings, knownStamps: stamps, aiDisclosure: sales?.salesRules.aiDisclosure ?? 'discreet', replyPace: sales?.salesRules.replyPace ?? DEFAULT_REPLY_PACE, businessHours: sales?.salesRules.businessHours ?? DEFAULT_BUSINESS_HOURS, promo: sales?.salesRules.promo ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[chat/agents/settings GET]', error instanceof Error ? error.name : 'unknown')
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
    const rate = await settingsRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id } = await context.params
    const agent = await ownedAgent(auth.tenantId, id)
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    }
    // Owner's active promotion (B1): validated + bounded by parsePromo; shipping method ids must be this business's.
    if ('promo' in body) {
      const promo = parsePromo(body.promo)
      const rawPromo = body.promo && typeof body.promo === 'object' ? (body.promo as Record<string, unknown>) : {}
      const bad = (error: string) => NextResponse.json({ success: false, error }, { status: 400 })
      // DATA-48: a blank row must never become "every product without a category" (fail closed, not open).
      if (Array.isArray(rawPromo.specialPrices) && Math.min(rawPromo.specialPrices.length, 10) !== promo.specialPrices.length) {
        return bad('Cada precio especial necesita su categoría o producto y un precio.')
      }
      if (promo.freeShippingMethodIds.length) {
        const own = await prisma.shippingMethod.findMany({ where: { tenantId: auth.tenantId, id: { in: promo.freeShippingMethodIds } }, select: { id: true } })
        const ownIds = new Set(own.map((m) => m.id))
        promo.freeShippingMethodIds = promo.freeShippingMethodIds.filter((x) => ownIds.has(x))
        // Unknown ids filtered to [] would mean "every method free".
        if (!promo.freeShippingMethodIds.length) return bad('Elegí métodos de envío de tu negocio para el envío gratis.')
      }
      // INT-77: the owner's line is data for the model — no amounts in words, no deals it didn't enable, no confirmations.
      if (promo.headline) {
        const enabled = [...(promo.freeShipping ? (['free_shipping'] as const) : []), ...(promo.specialPrices.length ? (['special_price'] as const) : [])]
        if (headlineHasNumberWords(promo.headline) || dealProblem(promo.headline, enabled) || hasConfirmationWording(promo.headline)) {
          return bad('La frase de la promo no puede tener montos (ni en palabras), ofertas que no activaste ni “pago confirmado”.')
        }
      }
      const before = await loadSalesSetup(auth.tenantId, agent.id).catch(() => null)
      try {
        await saveSalesSetup(auth.tenantId, agent.id, { salesRules: { promo } }, auth.userId)
      } catch (error) {
        if (error instanceof SalesRulesTooLargeError) {
          return NextResponse.json({ success: false, error: 'El guion de venta es demasiado largo: acortá algún texto o combo.' }, { status: 413 })
        }
        if (error instanceof SalesSetupNotReadyError) {
          return NextResponse.json({ success: false, error: 'Este ajuste todavía no está disponible.' }, { status: 503 })
        }
        throw error
      }
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatAgent',
        entityId: agent.id,
        entityName: agent.name,
        description: 'Promoción activa del agente',
        oldValues: { promo: before?.salesRules.promo ?? null },
        newValues: { promo },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
      return NextResponse.json({ success: true, promo })
    }
    // "¿Sos un bot?" toggle (stored with the sales script, SQL 053): saved on its own.
    if ('aiDisclosure' in body) {
      if (body.aiDisclosure !== 'transparent' && body.aiDisclosure !== 'discreet') {
        return NextResponse.json({ success: false, error: 'Valor inválido' }, { status: 400 })
      }
      const value: 'transparent' | 'discreet' = body.aiDisclosure
      const before = await loadSalesSetup(auth.tenantId, agent.id).catch(() => null)
      try {
        await saveSalesSetup(auth.tenantId, agent.id, { salesRules: { aiDisclosure: value } }, auth.userId)
      } catch (error) {
        if (error instanceof SalesRulesTooLargeError) {
          return NextResponse.json({ success: false, error: 'El guion de venta es demasiado largo: acortá algún texto o combo.' }, { status: 413 })
        }
        if (error instanceof SalesSetupNotReadyError) {
          return NextResponse.json({ success: false, error: 'Este ajuste todavía no está disponible.' }, { status: 503 })
        }
        throw error
      }
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatAgent',
        entityId: agent.id,
        entityName: agent.name,
        description: 'Cómo responde si le preguntan si es un bot',
        oldValues: { aiDisclosure: before?.salesRules.aiDisclosure ?? null },
        newValues: { aiDisclosure: value },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
      return NextResponse.json({ success: true, aiDisclosure: value })
    }
    // agents2-pace: "Velocidad de respuesta" (stored with the sales script, like aiDisclosure): saved on its own.
    if ('replyPace' in body) {
      const parsed = replyPaceSchema.safeParse(body.replyPace)
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: 'Valor inválido' }, { status: 400 })
      }
      const value = parsed.data
      const before = await loadSalesSetup(auth.tenantId, agent.id).catch(() => null)
      try {
        await saveSalesSetup(auth.tenantId, agent.id, { salesRules: { replyPace: value } }, auth.userId)
      } catch (error) {
        if (error instanceof SalesRulesTooLargeError) {
          return NextResponse.json({ success: false, error: 'El guion de venta es demasiado largo: acortá algún texto o combo.' }, { status: 413 })
        }
        if (error instanceof SalesSetupNotReadyError) {
          return NextResponse.json({ success: false, error: 'Este ajuste todavía no está disponible.' }, { status: 503 })
        }
        throw error
      }
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatAgent',
        entityId: agent.id,
        entityName: agent.name,
        description: 'Velocidad de respuesta del agente',
        oldValues: { replyPace: before?.salesRules.replyPace ?? null },
        newValues: { replyPace: value },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
      return NextResponse.json({ success: true, replyPace: value })
    }
    // agents2-hours: "Horario de atención" (same salesRules jsonb). The after-hours note is owner text the customer
    // reads as-is: same checks as a saved answer, no confirmations, no deals, no amounts in words.
    if ('businessHours' in body) {
      const parsed = businessHoursSchema.safeParse(body.businessHours)
      if (!parsed.success) {
        return NextResponse.json({ success: false, error: 'Horario inválido: revisá las horas de cada día.' }, { status: 400 })
      }
      let note: string | null = parsed.data.afterHoursNote?.trim() || null
      if (note) {
        const checked = ownerTextProblem(note, 'La nota fuera de horario')
        if (!checked.ok) return NextResponse.json({ success: false, error: checked.error }, { status: 400 })
        note = checked.text.trim()
        if (hasConfirmationWording(note) || dealProblem(note, []) || headlineHasNumberWords(note) || /\d/.test(note)) {
          return NextResponse.json({ success: false, error: 'La nota no puede tener montos ni números, ofertas ni “pago confirmado”.' }, { status: 400 })
        }
      }
      const value: BusinessHours = { enabled: parsed.data.enabled, timezone: BUSINESS_HOURS_TIMEZONE, windows: parsed.data.windows, afterHoursNote: note }
      const before = await loadSalesSetup(auth.tenantId, agent.id).catch(() => null)
      try {
        await saveSalesSetup(auth.tenantId, agent.id, { salesRules: { businessHours: value } }, auth.userId)
      } catch (error) {
        if (error instanceof SalesRulesTooLargeError) {
          return NextResponse.json({ success: false, error: 'El guion de venta es demasiado largo: acortá algún texto o combo.' }, { status: 413 })
        }
        if (error instanceof SalesSetupNotReadyError) {
          return NextResponse.json({ success: false, error: 'Este ajuste todavía no está disponible.' }, { status: 503 })
        }
        throw error
      }
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatAgent',
        entityId: agent.id,
        entityName: agent.name,
        description: 'Horario de atención del agente',
        oldValues: { businessHours: before?.salesRules.businessHours ?? null },
        newValues: { businessHours: value },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
      return NextResponse.json({ success: true, businessHours: value })
    }
    const patch: AgentSettingsPatch = {}
    if ('dailyTokenCap' in body) {
      const v = body.dailyTokenCap
      patch.dailyTokenCap = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
    }
    if ('orderOwnership' in body) patch.orderOwnership = body.orderOwnership as AgentSettingsPatch['orderOwnership']
    if ('orderDefaults' in body) {
      patch.orderDefaults = body.orderDefaults as AgentSettingsPatch['orderDefaults']
      const methodId = (body.orderDefaults as { shippingMethodId?: unknown } | null)?.shippingMethodId
      if (typeof methodId === 'string' && methodId.trim()) {
        const method = await prisma.shippingMethod.findFirst({ where: { id: methodId, tenantId: auth.tenantId, active: true }, select: { id: true } })
        if (!method) return NextResponse.json({ success: false, error: 'Ese método de envío no es de este negocio.' }, { status: 400 })
      }
    }
    if ('servesUnboundChannels' in body) patch.servesUnboundChannels = body.servesUnboundChannels === true
    const saved = await saveAgentSettings(auth.tenantId, agent.id, patch, auth.userId)
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatAgent',
      entityId: agent.id,
      entityName: agent.name,
      description: 'Ajustes del agente (pedidos, presupuesto, canales)',
      newValues: saved as unknown as Record<string, unknown>,
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, settings: saved })
  } catch (error) {
    if (error instanceof AgentSettingsNotReadyError) {
      return NextResponse.json({ success: false, error: 'Estos ajustes todavía no están disponibles.' }, { status: 503 })
    }
    console.error('[chat/agents/settings PUT]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar' }, { status: 500 })
  }
}
