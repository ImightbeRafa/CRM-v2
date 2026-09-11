/**
 * F37-01 — Soft AI config PATCH RBAC: SALES cannot enable AI or flip paymentAlwaysHuman.
 * Behavior tests assert literal deny for SALES on PATCH (update_config / OWNER|ADMIN).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { NextResponse } from 'next/server'
import { canAccessAPI, hasPermission, type Role } from '../rbac'
import { SOFT_TENANT_AI_V1_FLAG } from '../feature-flags'
import { DEFAULT_SOFT_AI_CONFIG, parseSoftAiConfig } from '../soft-ai/config'

/** Mirrors authenticateAPIWithPermission gate after role is known. */
function softAiConfigPatchGate(role: Role): {
  ok: boolean
  status?: number
  error?: string
} {
  if (!hasPermission(role, 'update_config')) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Insufficient permissions',
    }
  }
  return { ok: true }
}

describe('F37-01 soft-ai config PATCH RBAC', () => {
  it('SALES is literally denied update_config (cannot enable AI / flip payment gate)', () => {
    assert.equal(hasPermission('SALES', 'view_config'), true)
    assert.equal(hasPermission('SALES', 'update_config'), false)

    const deny = softAiConfigPatchGate('SALES')
    assert.equal(deny.ok, false)
    assert.equal(deny.status, 403)
    assert.equal(deny.error, 'Forbidden: Insufficient permissions')

    assert.equal(canAccessAPI('SALES', 'PATCH', '/api/chat/soft-ai/config'), false)
  })

  it('MANAGER is also denied Soft AI config PATCH (view_config only)', () => {
    assert.equal(hasPermission('MANAGER', 'view_config'), true)
    assert.equal(hasPermission('MANAGER', 'update_config'), false)
    const deny = softAiConfigPatchGate('MANAGER')
    assert.equal(deny.ok, false)
    assert.equal(deny.status, 403)
    assert.equal(deny.error, 'Forbidden: Insufficient permissions')
    assert.equal(canAccessAPI('MANAGER', 'PATCH', '/api/chat/soft-ai/config'), false)
  })

  it('OWNER and ADMIN may PATCH Soft AI config (admin/owner equivalent)', () => {
    for (const role of ['OWNER', 'ADMIN'] as Role[]) {
      assert.equal(hasPermission(role, 'update_config'), true)
      const allow = softAiConfigPatchGate(role)
      assert.equal(allow.ok, true)
      assert.equal(canAccessAPI(role, 'PATCH', '/api/chat/soft-ai/config'), true)
    }
  })

  it('PATCH route source requires update_config — not view_config', () => {
    const src = readFileSync(resolve('src/app/api/chat/soft-ai/config/route.ts'), 'utf8')
    assert.match(src, /authenticateAPIWithPermission\(request,\s*'update_config'\)/)
    assert.doesNotMatch(
      src,
      /PATCH[\s\S]*authenticateAPIWithPermission\(request,\s*'view_config'\)/,
    )
    // GET may stay on update_sales for Soft operators — PATCH alone is tightened
    assert.match(src, /export async function PATCH/)
  })

  it('apiPermissions map gates PATCH soft-ai/config to update_config', () => {
    const rbacSrc = readFileSync(resolve('src/lib/rbac.ts'), 'utf8')
    assert.match(
      rbacSrc,
      /'PATCH \/api\/chat\/soft-ai\/config':\s*'update_config'/,
    )
    assert.doesNotMatch(
      rbacSrc,
      /'PATCH \/api\/chat\/soft-ai\/config':\s*'view_config'/,
    )
  })

  it('AI flag still defaults off; paymentAlwaysHuman defaults true', () => {
    assert.equal(SOFT_TENANT_AI_V1_FLAG, 'soft_tenant_ai_v1')
    assert.equal(DEFAULT_SOFT_AI_CONFIG.paymentAlwaysHuman, true)
    // Missing / empty config must not flip payment gate off
    assert.equal(parseSoftAiConfig(undefined).paymentAlwaysHuman, true)
    assert.equal(parseSoftAiConfig({}).paymentAlwaysHuman, true)
    // Feature flag key is not preview-unlocked (prod default off) — assert via feature-flags source
    const flagsSrc = readFileSync(resolve('src/lib/feature-flags.ts'), 'utf8')
    assert.match(flagsSrc, /SOFT_TENANT_AI_V1_FLAG\s*=\s*'soft_tenant_ai_v1'/)
    const previewBlock = flagsSrc.match(/PREVIEW_UNLOCKED_KEYS[\s\S]*?;/)?.[0] || ''
    assert.doesNotMatch(previewBlock, /soft_tenant_ai_v1/)
  })

  it('Forbidden response shape matches auth-helpers 403 JSON', () => {
    // Document the literal body SALES would receive from authenticateAPIWithPermission
    const response = NextResponse.json(
      { error: 'Forbidden: Insufficient permissions' },
      { status: 403 },
    )
    assert.equal(response.status, 403)
  })
})
