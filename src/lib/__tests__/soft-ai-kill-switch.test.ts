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
    assert.match(src, /isSuperAdmin\(auth\.userId\)/)
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
