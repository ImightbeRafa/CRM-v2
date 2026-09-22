/**
 * SD54-01 — cross-tenant socialAccountId must be rejected before bind/panic writes.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireTenantSocialAccount } from '../soft-ai/agent-admin'

describe('SD54-01 tenant-owned socialAccountId', () => {
  it('rejects missing / cross-tenant socialAccountId (404 contract)', async () => {
    await assert.rejects(
      () =>
        requireTenantSocialAccount('tenant-a', 'account-from-tenant-b', {
          findFirst: async () => null,
        }),
      (err: unknown) =>
        err instanceof Error && err.message === 'SOCIAL_ACCOUNT_NOT_FOUND',
    )
  })

  it('accepts socialAccountId that belongs to the tenant', async () => {
    const row = await requireTenantSocialAccount('tenant-a', 'acct-1', {
      findFirst: async (args) => {
        assert.equal(args.where.tenantId, 'tenant-a')
        assert.equal(args.where.id, 'acct-1')
        return { id: 'acct-1' }
      },
    })
    assert.equal(row.id, 'acct-1')
  })

  it('setAgentBinding / panic paths call requireTenantSocialAccount before writes', () => {
    const admin = readFileSync(
      join(process.cwd(), 'src/lib/soft-ai/agent-admin.ts'),
      'utf8',
    )
    assert.match(admin, /export async function requireTenantSocialAccount/)
    assert.match(admin, /await requireTenantSocialAccount\(input\.tenantId, input\.socialAccountId\)/)
    // Binding create is after the ownership check in setAgentBinding
    const bindIdx = admin.indexOf('export async function setAgentBinding')
    const requireInBind = admin.indexOf(
      'await requireTenantSocialAccount(input.tenantId, input.socialAccountId)',
      bindIdx,
    )
    const createIdx = admin.indexOf('prisma.chatAgentBinding.create', bindIdx)
    assert.ok(requireInBind > bindIdx && requireInBind < createIdx)

    const pauseIdx = admin.indexOf('export async function panicPauseChannel')
    const requireInPause = admin.indexOf('requireTenantSocialAccount', pauseIdx)
    const updateIdx = admin.indexOf('chatAgentBinding.updateMany', pauseIdx)
    assert.ok(requireInPause > pauseIdx && requireInPause < updateIdx)

    const removeIdx = admin.indexOf('export async function panicRemoveAllowlist')
    const requireInRemove = admin.indexOf('requireTenantSocialAccount', removeIdx)
    const mutateIdx = admin.indexOf('mutateChatAgentLayerConfig', removeIdx)
    assert.ok(requireInRemove > removeIdx && requireInRemove < mutateIdx)
  })

  it('panic route does not hardcode Forge WA as silent default', () => {
    const panic = readFileSync(
      join(process.cwd(), 'src/app/api/chat/agents/[id]/panic/route.ts'),
      'utf8',
    )
    assert.doesNotMatch(panic, /FORGE_WA_SOCIAL_ACCOUNT_ID/)
    assert.match(panic, /resolvePanicSocialAccountId/)
    assert.match(panic, /SOCIAL_ACCOUNT_NOT_FOUND/)
  })

  it('bindings route maps SOCIAL_ACCOUNT_NOT_FOUND to 404', () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/chat/agents/[id]/bindings/route.ts'),
      'utf8',
    )
    assert.match(route, /SOCIAL_ACCOUNT_NOT_FOUND/)
    assert.match(route, /status: 404/)
  })
})
