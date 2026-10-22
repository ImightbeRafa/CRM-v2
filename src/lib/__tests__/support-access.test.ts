import test from 'node:test'
import assert from 'node:assert/strict'
import { canViewerSeeTicket, viewerTicketWhere } from '../support/access'
import { decideCustomAgentAccess, parseCustomAgentsConfig } from '../support/agent-access-core'

const ticket = { userId: 'u-author', tenantId: 't-a' }

test('ticket visibility matrix: author, tenant OWNER/ADMIN yes; other members, other tenants, anon no', () => {
  const cases: Array<[string, Parameters<typeof canViewerSeeTicket>[0], boolean]> = [
    ['anonymous', { userId: '', tenantId: null, role: null }, false],
    ['author (any role)', { userId: 'u-author', tenantId: 't-a', role: 'VIEWER' }, true],
    ['author after switching business', { userId: 'u-author', tenantId: 't-b', role: 'VIEWER' }, true],
    ['same-tenant SALES member', { userId: 'u-2', tenantId: 't-a', role: 'SALES' }, false],
    ['same-tenant MANAGER', { userId: 'u-2', tenantId: 't-a', role: 'MANAGER' }, false],
    ['same-tenant OWNER', { userId: 'u-3', tenantId: 't-a', role: 'OWNER' }, true],
    ['same-tenant ADMIN', { userId: 'u-3', tenantId: 't-a', role: 'ADMIN' }, true],
    ['other-tenant OWNER', { userId: 'u-4', tenantId: 't-b', role: 'OWNER' }, false],
  ]
  for (const [label, viewer, expected] of cases) assert.equal(canViewerSeeTicket(viewer, ticket), expected, label)
})

test('public contact tickets (no tenant, no user) are invisible to every session', () => {
  const anonTicket = { userId: null, tenantId: null }
  assert.equal(canViewerSeeTicket({ userId: 'u', tenantId: 't-a', role: 'OWNER' }, anonTicket), false)
})

test('viewerTicketWhere matches canViewerSeeTicket and hides spam', () => {
  assert.deepEqual(viewerTicketWhere({ userId: 'u1', tenantId: 't-a', role: 'SALES' }), {
    OR: [{ userId: 'u1' }],
    NOT: { status: 'spam' },
  })
  assert.deepEqual(viewerTicketWhere({ userId: 'u1', tenantId: 't-a', role: 'OWNER' }), {
    OR: [{ userId: 'u1' }, { tenantId: 't-a' }],
    NOT: { status: 'spam' },
  })
})

test('custom_agents decision: legacy when the pipeline is off, else super admin or explicit flag', () => {
  assert.deepEqual(decideCustomAgentAccess({ pipelineEnabled: false, superAdmin: false, flagEnabled: null }), {
    enabled: true,
    reason: 'legacy',
  })
  assert.equal(decideCustomAgentAccess({ pipelineEnabled: true, superAdmin: true, flagEnabled: false }).enabled, true)
  assert.equal(decideCustomAgentAccess({ pipelineEnabled: true, superAdmin: false, flagEnabled: true }).enabled, true)
  assert.equal(decideCustomAgentAccess({ pipelineEnabled: true, superAdmin: false, flagEnabled: false }).enabled, false)
  // No row = off (no implicit grandfathering; the seed script writes explicit rows).
  assert.equal(decideCustomAgentAccess({ pipelineEnabled: true, superAdmin: false, flagEnabled: null }).enabled, false)
})

test('custom_agents config parsing: missing/invalid → empty, never throws', () => {
  for (const raw of [null, undefined, 'x', 42, [], { agentIds: 'nope' }]) {
    assert.deepEqual(parseCustomAgentsConfig(raw), { agentIds: [], enabledBy: null, enabledAt: null })
  }
  assert.deepEqual(
    parseCustomAgentsConfig({ agentIds: ['a1', 'a1', 'bad id!', 7, 'b2'], enabledBy: 'u1', enabledAt: '2026-10-22T10:00:00Z' }),
    { agentIds: ['a1', 'b2'], enabledBy: 'u1', enabledAt: '2026-10-22T10:00:00Z' },
  )
  assert.equal(parseCustomAgentsConfig({ enabledAt: 'not a date' }).enabledAt, null)
})
