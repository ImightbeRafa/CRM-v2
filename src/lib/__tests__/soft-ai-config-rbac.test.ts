/**
 * F37-01 — Soft AI config PATCH privilege gates (exact orch wording).
 * Behavior tests assert literal deny for SALES/MANAGER on enable + payment flip.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { canAccessAPI, hasPermission, type Role } from '../rbac'
import { SOFT_TENANT_AI_V1_FLAG } from '../feature-flags'
import { DEFAULT_SOFT_AI_CONFIG, parseSoftAiConfig } from '../soft-ai/config'
import {
  SOFT_AI_CONFIG_FORBIDDEN,
  SOFT_AI_PAYMENT_GATE_FORBIDDEN,
  canDisablePaymentAlwaysHuman,
  canEnableSoftTenantAi,
  decideSoftAiConfigPatch,
  wantsEnabledTrueFromBody,
  wantsPaymentAlwaysHumanFalseFromBody,
} from '../soft-ai/config-rbac'

describe('F37-01 soft-ai config PATCH RBAC', () => {
  it('SALES/MANAGER with only view_config cannot flip enabled:true', () => {
    for (const role of ['SALES', 'MANAGER'] as Role[]) {
      assert.equal(hasPermission(role, 'view_config'), true)
      assert.equal(hasPermission(role, 'update_config'), false)
      assert.equal(canEnableSoftTenantAi(role), false)

      const deny = decideSoftAiConfigPatch({
        role,
        wantsEnabledTrue: true,
        wantsPaymentAlwaysHumanFalse: false,
      })
      assert.equal(deny.ok, false)
      if (!deny.ok) {
        assert.equal(deny.status, 403)
        assert.equal(deny.error, SOFT_AI_CONFIG_FORBIDDEN)
        assert.equal(deny.error, 'Forbidden: Insufficient permissions')
      }

      assert.equal(canAccessAPI(role, 'PATCH', '/api/chat/soft-ai/config'), false)
    }
  })

  it('refuses paymentAlwaysHuman:false unless OWNER/ADMIN (fail closed)', () => {
    for (const role of ['SALES', 'MANAGER', 'VIEWER', 'PRODUCTION'] as Role[]) {
      assert.equal(canDisablePaymentAlwaysHuman(role), false)
      const deny = decideSoftAiConfigPatch({
        role,
        wantsEnabledTrue: false,
        wantsPaymentAlwaysHumanFalse: true,
      })
      assert.equal(deny.ok, false)
      if (!deny.ok) {
        assert.equal(deny.status, 403)
        assert.equal(deny.error, SOFT_AI_PAYMENT_GATE_FORBIDDEN)
      }
    }

    for (const role of ['OWNER', 'ADMIN'] as Role[]) {
      assert.equal(canDisablePaymentAlwaysHuman(role), true)
      const allow = decideSoftAiConfigPatch({
        role,
        wantsEnabledTrue: true,
        wantsPaymentAlwaysHumanFalse: true,
      })
      assert.equal(allow.ok, true)
    }
  })

  it('OWNER/ADMIN with update_config may set enabled:true', () => {
    for (const role of ['OWNER', 'ADMIN'] as Role[]) {
      assert.equal(canEnableSoftTenantAi(role), true)
      assert.equal(hasPermission(role, 'update_config'), true)
      const allow = decideSoftAiConfigPatch({
        role,
        wantsEnabledTrue: true,
        wantsPaymentAlwaysHumanFalse: false,
      })
      assert.equal(allow.ok, true)
      assert.equal(canAccessAPI(role, 'PATCH', '/api/chat/soft-ai/config'), true)
    }
  })

  it('body helpers detect enabled:true and paymentAlwaysHuman:false literally', () => {
    assert.equal(wantsEnabledTrueFromBody({ enabled: true }, false), true)
    assert.equal(wantsEnabledTrueFromBody({ enabled: false }, true), false)
    assert.equal(wantsEnabledTrueFromBody({}, false), false)
    assert.equal(wantsPaymentAlwaysHumanFalseFromBody({ paymentAlwaysHuman: false }), true)
    assert.equal(
      wantsPaymentAlwaysHumanFalseFromBody({ config: { paymentAlwaysHuman: false } }),
      true,
    )
    assert.equal(wantsPaymentAlwaysHumanFalseFromBody({ paymentAlwaysHuman: true }), false)
    assert.equal(wantsPaymentAlwaysHumanFalseFromBody({}), false)
  })

  it('PATCH route uses update_config + decideSoftAiConfigPatch fail-closed', () => {
    const src = readFileSync(resolve('src/app/api/chat/soft-ai/config/route.ts'), 'utf8')
    assert.match(src, /authenticateAPIWithPermission\(request,\s*'update_config'\)/)
    assert.match(src, /decideSoftAiConfigPatch/)
    assert.match(src, /wantsPaymentAlwaysHumanFalse/)
    assert.doesNotMatch(
      src,
      /PATCH[\s\S]*authenticateAPIWithPermission\(request,\s*'view_config'\)/,
    )
  })

  it('apiPermissions map gates PATCH soft-ai/config to update_config', () => {
    const rbacSrc = readFileSync(resolve('src/lib/rbac.ts'), 'utf8')
    assert.match(
      rbacSrc,
      /'PATCH \/api\/chat\/soft-ai\/config':\s*'update_config'/,
    )
  })

  it('soft_tenant_ai_v1 defaults off; paymentAlwaysHuman defaults true', () => {
    assert.equal(SOFT_TENANT_AI_V1_FLAG, 'soft_tenant_ai_v1')
    assert.equal(DEFAULT_SOFT_AI_CONFIG.paymentAlwaysHuman, true)
    assert.equal(parseSoftAiConfig(undefined).paymentAlwaysHuman, true)
    assert.equal(parseSoftAiConfig({}).paymentAlwaysHuman, true)
    const flagsSrc = readFileSync(resolve('src/lib/feature-flags.ts'), 'utf8')
    const previewBlock = flagsSrc.match(/PREVIEW_UNLOCKED_KEYS[\s\S]*?;/)?.[0] || ''
    assert.doesNotMatch(previewBlock, /soft_tenant_ai_v1/)
  })
})
