import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  KILL_GLOBAL_KEY,
  envKillArmed,
  killTenantKey,
  readAgentKillState,
} from '@/lib/soft-ai/agent-kill-switch'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const saved = process.env.SOFT_AGENT_KILL
afterEach(() => {
  if (saved === undefined) delete process.env.SOFT_AGENT_KILL
  else process.env.SOFT_AGENT_KILL = saved
})

describe('kill switch env trigger', () => {
  it('arms on 1/true/on and ignores everything else', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', ' 1 ']) {
      process.env.SOFT_AGENT_KILL = v
      assert.equal(envKillArmed(), true, v)
    }
    for (const v of ['', '0', 'false', 'no', 'off']) {
      process.env.SOFT_AGENT_KILL = v
      assert.equal(envKillArmed(), false, v)
    }
  })

  it('env trigger works without touching the database', async () => {
    process.env.SOFT_AGENT_KILL = '1'
    assert.deepEqual(await readAgentKillState('tenant-x'), { armed: true, source: 'env' })
  })

  it('keys are namespaced per tenant', () => {
    assert.equal(KILL_GLOBAL_KEY, 'agent_kill_global')
    assert.equal(killTenantKey('abc'), 'agent_kill_tenant:abc')
  })
})

describe('kill switch wiring (static)', () => {
  it('claim gate and pre-send gate both check it before anything else', () => {
    const src = read('src/lib/soft-ai/agent-claim-gates.ts')
    const claim = src.slice(src.indexOf('export async function runClaimGates'))
    assert.ok(claim.indexOf('readAgentKillState') < claim.indexOf('input.superseded'))
    const pre = src.slice(src.indexOf('export async function runPreSendGates'))
    assert.ok(pre.indexOf('readAgentKillState') < pre.indexOf('hasHumanRepliedAfter'))
    assert.match(src, /skipReason: 'kill_switch'/)
  })

  it('the legacy Soft path is stopped too and the turn passes tenantId to the claim gate', () => {
    assert.match(read('src/lib/soft-ai/automation-processor.ts'), /readAgentKillState\(row\.tenantId\)/)
    assert.match(read('src/lib/soft-ai/agent-turn.ts'), /runClaimGates\(\{\s*tenantId: row\.tenantId/)
  })

  it('Probar (test turns) does not read the kill switch', () => {
    const src = read('src/lib/soft-ai/agent-turn.ts')
    const probar = src.slice(src.indexOf('export async function runAgentTestTurn'))
    assert.doesNotMatch(probar.slice(0, 6000), /readAgentKillState/)
  })

  it('admin route is super-admin only, needs a reason and is audited', () => {
    const src = read('src/app/api/super-admin/agent-kill/route.ts')
    assert.match(src, /isSuperAdmin\(userId\)/)
    assert.match(src, /status: 404/)
    assert.match(src, /reason\.length < 3/)
    assert.match(src, /logAuditEvent/)
  })
})

describe('SQL 044', () => {
  const sql = read('supabase/migrations/044_platform_agent_policy.sql')
  it('is additive, RLS-enabled, FK-free and key-constrained', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."PlatformAgentPolicy"/)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.doesNotMatch(sql, /REFERENCES|DROP |TRUNCATE/i)
    assert.match(sql, /agent_kill_global/)
  })
  it('is registered in the apply manifest and kept out of the default set', () => {
    const manifest = read('scripts/lib/betsy-v2-additive-manifest.mjs')
    assert.match(manifest, /'044': '044_platform_agent_policy\.sql'/)
    assert.match(manifest, /DEFAULT_APPLY_FILES = '018,019,020,021,022,023,024'/)
  })
})

describe('kill switch hardening (static)', () => {
  it('the admin route needs a real boolean (a missing/stringly armed never disarms)', () => {
    assert.match(read('src/app/api/super-admin/agent-kill/route.ts'), /typeof body\?\.armed !== 'boolean'/)
  })
  it('every path into the legacy Soft turn checks the kill switch', () => {
    const src = read('src/lib/soft-ai/automation-processor.ts')
    const legacy = src.slice(src.indexOf('async function dispatchLegacy'))
    assert.ok(legacy.indexOf('readAgentKillState') > -1 && legacy.indexOf('readAgentKillState') < legacy.indexOf('readPayload'))
  })
  it('missing tables use the shared relation check and a cached to_regclass probe, not a loose regex', () => {
    const kill = read('src/lib/soft-ai/agent-kill-switch.ts')
    assert.match(kill, /isMissingRelation/)
    assert.match(kill, /isTableReady/)
    assert.doesNotMatch(kill, /does not exist\|P2021/)
    assert.match(read('src/lib/soft-ai/table-ready.ts'), /to_regclass/)
  })
  it('SQL 044 and 045 are tracked (the migrations folder is gitignored)', () => {
    assert.ok(read('supabase/migrations/044_platform_agent_policy.sql').length > 100)
    assert.ok(read('supabase/migrations/045_agent_improvement.sql').length > 100)
  })
})

describe('kill switch route hardening (SecureDog INT-14/16)', () => {
  const src = read('src/app/api/super-admin/agent-kill/route.ts')
  it('requires a known scope, a boolean and an existing business, and is not blocked by billing', () => {
    assert.match(src, /scope !== 'global' && scope !== 'tenant'/)
    assert.match(src, /prisma\.tenant\.findUnique/)
    assert.match(src, /getLiveToken/)
    assert.doesNotMatch(src.slice(src.indexOf('export async function POST')), /authenticateAPI\(/)
  })
  it('files a per-business stop in that business audit log', () => {
    assert.match(src, /auditTenantId = tenantId/)
  })
  it('a read error never disarms a switch that was armed', () => {
    assert.match(read('src/lib/soft-ai/agent-kill-switch.ts'), /armed = hit\?\.armed === true/)
  })
})

describe('analytics read guard rails (SecureDog INT-15/17)', () => {
  it('reads run with a statement timeout and tenant routes cap at 30 days with a short cache', () => {
    assert.match(read('src/lib/soft-ai/safe-query.ts'), /statement_timeout = '8s'/)
    assert.match(read('src/lib/soft-ai/agent-usage-server.ts'), /queryWithTimeout/)
    assert.match(read('src/lib/soft-ai/agent-improvement.ts'), /queryWithTimeout/)
    for (const p of ['src/app/api/chat/agents/usage/route.ts', 'src/app/api/chat/agents/scorecard/route.ts']) {
      const src = read(p)
      assert.match(src, /Math\.min\(30,/)
      assert.match(src, /memoTtl\(/)
    }
  })
  it('platform scope is explicit (tenantId: null), never an omitted argument', () => {
    for (const p of ['src/app/api/super-admin/agent-usage/route.ts', 'src/app/api/super-admin/agent-scorecard/route.ts']) {
      assert.match(read(p), /tenantId: null/)
    }
  })
  it('feedback accepts no free text and the eval history is capped', () => {
    assert.match(read('src/lib/soft-ai/agent-scorecard.ts'), /note: null/)
    assert.match(read('src/lib/soft-ai/agent-improvement.ts'), /LIMIT 20/)
  })
})
