/**
 * Soft Tenant AI config skeleton — GET/PATCH personality, KB, allowlist, payment gate.
 * Persists on TenantFeatureFlag.config for soft_tenant_ai_v1 (creates flag row if missing).
 * Enabling the worker remains a separate `enabled` flip (default off).
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
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response

    const { tenantId } = auth
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }

    const db = prisma as any
    const existing = await db.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: SOFT_TENANT_AI_V1_FLAG },
      select: { id: true, enabled: true, config: true },
    })

    const merged = parseSoftAiConfig({
      ...(existing?.config && typeof existing.config === 'object' ? existing.config : {}),
      ...(body.config && typeof body.config === 'object' ? body.config : body),
    })
    // Force payment gate on unless explicit false is sent via config.paymentAlwaysHuman
    if (body.config?.paymentAlwaysHuman === false || body.paymentAlwaysHuman === false) {
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
