/**
 * Soft Tenant AI config skeleton — GET/PATCH personality, KB, allowlist, payment gate.
 * Persists on TenantFeatureFlag.config for soft_tenant_ai_v1 (creates flag row if missing).
 * Enabling the worker remains a separate `enabled` flip (default off).
 *
 * F37-01: PATCH requires update_config; paymentAlwaysHuman:false fail-closed OWNER/ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import {
  DEFAULT_SOFT_AI_CONFIG,
  parseSoftAiConfig,
  softAiConfigToJson,
} from '@/lib/soft-ai/config'
import {
  decideSoftAiConfigPatch,
  wantsEnabledTrueFromBody,
  wantsPaymentAlwaysHumanFalseFromBody,
} from '@/lib/soft-ai/config-rbac'
import type { Role } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { tenantId } = auth
    const db = prisma as any
    const flag = await db.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: SOFT_TENANT_AI_V1_FLAG },
      select: { enabled: true, config: true },
    })

    return NextResponse.json({
      success: true,
      enabled: flag?.enabled === true,
      config: parseSoftAiConfig(flag?.config),
      defaults: DEFAULT_SOFT_AI_CONFIG,
    })
  } catch (error) {
    console.error('[soft-ai/config GET]', error)
    return NextResponse.json({ success: false, error: 'Error al leer config Soft AI' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Outer gate: update_config (OWNER/ADMIN). SALES/MANAGER view_config-only cannot PATCH.
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response

    const { tenantId, role } = auth
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }

    const db = prisma as any
    const existing = await db.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: SOFT_TENANT_AI_V1_FLAG },
      select: { id: true, enabled: true, config: true },
    })

    const bodyRec = body as Record<string, unknown>
    const existingEnabled = existing?.enabled === true
    const wantsEnabledTrue = wantsEnabledTrueFromBody(bodyRec, existingEnabled)
    const wantsPaymentFalse = wantsPaymentAlwaysHumanFalseFromBody(bodyRec)

    // Exact orch gates (defense in depth beyond update_config).
    const decision = decideSoftAiConfigPatch({
      role: role as Role,
      wantsEnabledTrue,
      wantsPaymentAlwaysHumanFalse: wantsPaymentFalse,
    })
    if (!decision.ok) {
      return NextResponse.json({ success: false, error: decision.error }, { status: decision.status })
    }

    const merged = parseSoftAiConfig({
      ...(existing?.config && typeof existing.config === 'object' ? existing.config : {}),
      ...(body.config && typeof body.config === 'object' ? body.config : body),
    })

    // Fail closed on payment gate: only OWNER/ADMIN path above may set false.
    if (wantsPaymentFalse) {
      merged.paymentAlwaysHuman = false
    } else {
      merged.paymentAlwaysHuman = true
    }

    const enabled =
      typeof body.enabled === 'boolean' ? body.enabled : existing?.enabled === true

    const configJson = softAiConfigToJson(merged)

    if (existing?.id) {
      await db.tenantFeatureFlag.update({
        where: { id: existing.id },
        data: { enabled, config: configJson },
      })
    } else {
      // New rows stay disabled unless an authorized caller sets enabled:true.
      await db.tenantFeatureFlag.create({
        data: {
          scope: tenantId,
          tenantId,
          key: SOFT_TENANT_AI_V1_FLAG,
          enabled,
          config: configJson,
        },
      })
    }

    return NextResponse.json({
      success: true,
      enabled,
      config: merged,
    })
  } catch (error) {
    console.error('[soft-ai/config PATCH]', error)
    return NextResponse.json({ success: false, error: 'Error al guardar config Soft AI' }, { status: 500 })
  }
}
