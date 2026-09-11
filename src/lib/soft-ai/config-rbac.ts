/**
 * F37-01 Soft AI config privilege gates (exact orch wording).
 * - enabled:true requires update_config (OWNER/ADMIN) — SALES/MANAGER view_config only must not flip on.
 * - paymentAlwaysHuman:false refused unless OWNER/ADMIN (fail closed).
 */

import { hasPermission, type Role } from '@/lib/rbac'

export const SOFT_AI_CONFIG_FORBIDDEN = 'Forbidden: Insufficient permissions'
export const SOFT_AI_PAYMENT_GATE_FORBIDDEN =
  'Forbidden: solo OWNER/ADMIN puede desactivar paymentAlwaysHuman'

/** Gate for flipping soft_tenant_ai_v1 enabled:true. */
export function canEnableSoftTenantAi(role: Role): boolean {
  return hasPermission(role, 'update_config')
}

/** Fail-closed: only OWNER/ADMIN may set paymentAlwaysHuman:false. */
export function canDisablePaymentAlwaysHuman(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export type SoftAiConfigPatchDecision =
  | { ok: true }
  | { ok: false; status: 403; error: string }

/**
 * Privilege decision for Soft AI config PATCH mutations.
 * Call after auth; SALES/MANAGER with only view_config fail here for enable / payment flip.
 */
export function decideSoftAiConfigPatch(opts: {
  role: Role
  /** True when the request would set enabled to true. */
  wantsEnabledTrue: boolean
  /** True when the request explicitly sets paymentAlwaysHuman to false. */
  wantsPaymentAlwaysHumanFalse: boolean
}): SoftAiConfigPatchDecision {
  if (opts.wantsEnabledTrue && !canEnableSoftTenantAi(opts.role)) {
    return { ok: false, status: 403, error: SOFT_AI_CONFIG_FORBIDDEN }
  }
  if (opts.wantsPaymentAlwaysHumanFalse && !canDisablePaymentAlwaysHuman(opts.role)) {
    return { ok: false, status: 403, error: SOFT_AI_PAYMENT_GATE_FORBIDDEN }
  }
  return { ok: true }
}

export function wantsEnabledTrueFromBody(
  body: Record<string, unknown>,
  _existingEnabled: boolean,
): boolean {
  // Only gate when the request explicitly flips the worker on.
  return body.enabled === true
}

export function wantsPaymentAlwaysHumanFalseFromBody(body: Record<string, unknown>): boolean {
  if (body.paymentAlwaysHuman === false) return true
  const cfg = body.config
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    return (cfg as Record<string, unknown>).paymentAlwaysHuman === false
  }
  return false
}
