import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCorreosTrackingSync } from '../correos/v3/tracking-sync';
import { softAiToolDefinitions } from '../soft-ai/llm/tool-definitions';
import { runA1Tool, type SoftAiToolRunContext } from '../soft-ai/llm/tool-runner';
import { A1_TOOL_NAMES, A3_TOOL_NAMES } from '../soft-ai/agent-types';

const CTX: SoftAiToolRunContext = {
  tenantId: 't1',
  conversationId: 'c1',
  socialAccountId: 's1',
  peerId: 'p1',
  enabledTools: [...A1_TOOL_NAMES, ...A3_TOOL_NAMES],
  sandbox: true,
};

describe('Correos tracking sync', () => {
  it('does nothing unless CORREOS_TRACKING_SYNC=1', async () => {
    const r = await runCorreosTrackingSync({ env: {} });
    assert.equal(r.skipped, 'CORREOS_TRACKING_SYNC is off');
    assert.equal(r.checked, 0);
  });

  it('is wired into the 5-minute worker cron, before the slow channel-silence', () => {
    const w = readFileSync('src/cf-container-worker.ts', 'utf8');
    assert.match(w, /"\*\/5 \* \* \* \*": \[[^\]]*"\/api\/cron\/correos-tracking", "\/api\/cron\/ai-budget", "\/api\/cron\/channel-silence"\]/);
    assert.match(readFileSync('src/app/api/cron/correos-tracking/route.ts', 'utf8'), /requireCronBearer\(request\)/);
  });

  it('never moves CRM order status (only lm_order_events + optional lm_orders)', () => {
    const src = readFileSync('src/lib/correos/v3/tracking-sync.ts', 'utf8');
    assert.doesNotMatch(src, /setLifecycleOrderStatus|order\.update\(/);
    assert.match(src, /CORREOS_TRACKING_LM_STATUS === '1'/);
  });
});

describe('Correos inbox agent tools', () => {
  it('are strict, read-only schemas (every property required)', () => {
    const defs = softAiToolDefinitions([...A3_TOOL_NAMES]);
    for (const name of A3_TOOL_NAMES) {
      const d = defs.find((x) => x.name === name);
      assert.ok(d, name);
      assert.equal(d!.strict, true);
      const p = d!.parameters as { properties: Record<string, unknown>; required: string[] };
      assert.deepEqual([...p.required].sort(), Object.keys(p.properties).sort());
    }
  });

  it('are off unless the agent enabled them', async () => {
    const r = await runA1Tool({ ...CTX, enabledTools: [...A1_TOOL_NAMES] }, 'find_correos_branches', '{"province":"San José","canton":"Escazú"}');
    assert.equal(r.ok, false);
    assert.deepEqual(r.result, { error: 'tool_not_enabled' });
  });

  it('reject odd input instead of calling Correos', async () => {
    const r = await runA1Tool(CTX, 'check_correos_address', JSON.stringify({ province: 'San José', canton: '<script>', district: 'x', barrio: null }));
    assert.equal(r.ok, false);
    assert.equal(r.result.error, 'invalid_place');
  });

  it('answer from fixtures in Probar (sandbox)', async () => {
    const b = await runA1Tool(CTX, 'find_correos_branches', JSON.stringify({ province: 'San José', canton: 'San José' }));
    assert.equal(b.ok, true);
    assert.equal(b.result.sandbox, true);
    const a = await runA1Tool(CTX, 'check_correos_address', JSON.stringify({ province: 'San José', canton: 'San José', district: 'Carmen', barrio: null }));
    assert.equal(a.ok, true);
    assert.equal(a.result.postalCode, '10101');
  });

  it('do not quote Correos freight to customers', () => {
    const src = readFileSync('src/lib/soft-ai/llm/tool-runner.ts', 'utf8');
    assert.doesNotMatch(src, /\.quote\(/);
  });
});

describe('Correos guía ownership (SecureDog DATA-74)', () => {
  it('only counts completed Correos guías of this store that no other store holds', async () => {
    const { ownedGuiaNumbers } = await import('../correos/v3/tenant');
    const rows = [
      { tenantId: 'A', carrier: 'correos_cr', status: 'completed', guiaNumber: 'PY1CR', trackingNumber: 'PY1CR' },
      { tenantId: 'A', carrier: 'manual', status: 'completed', guiaNumber: 'PY2CR', trackingNumber: 'PY2CR' },
      { tenantId: 'A', carrier: 'correos_cr', status: 'failed', guiaNumber: 'PY3CR', trackingNumber: null },
      { tenantId: 'A', carrier: 'correos_cr', status: 'completed', guiaNumber: 'PY4CR', trackingNumber: 'PY4CR' },
      { tenantId: 'B', carrier: 'manual', status: 'completed', guiaNumber: 'PY4CR', trackingNumber: 'PY4CR' },
      { tenantId: 'A', carrier: 'correos_cr', status: 'completed', guiaNumber: 'PY5CR', trackingNumber: 'PY5CR' },
      { tenantId: 'B', carrier: 'correos_cr', status: 'completed', guiaNumber: 'PY5CR', trackingNumber: 'PY5CR' },
    ];
    // A hand-typed number elsewhere never blocks the owner; two Correos-issued holders = nobody.
    assert.deepEqual(ownedGuiaNumbers('A', ['PY1CR', 'PY2CR', 'PY3CR', 'PY4CR', 'PY5CR'], rows), ['PY1CR', 'PY4CR']);
    // B typed A's number as a manual guía: B gets nothing.
    assert.deepEqual(ownedGuiaNumbers('B', ['PY1CR', 'PY4CR'], rows), []);
  });

  it('manual guías cannot take a number another store already has', () => {
    const src = readFileSync('src/app/api/shipping/guias/manual/route.ts', 'utf8');
    assert.match(src, /tenantId: \{ not: tenantId \}/);
  });

  it('events are unique per store and a registration takes over tracker-made rows only', () => {
    const sql = readFileSync('supabase/migrations/065_correos_v3.sql', 'utf8');
    assert.match(sql, /lm_correos_tracking_events \(crm_tenant_id, guia_number,/);
    const store = readFileSync('src/lib/correos/v3/store.ts', 'utf8');
    assert.match(store, /WHERE lm_correos_guias\.crm_tenant_id = EXCLUDED\.crm_tenant_id OR lm_correos_guias\.api_version = 'soap'/);
    assert.match(store, /if \(prev\[0\] && prev\[0\]\.crm_tenant_id !== tenantId\) return null;/);
    assert.match(store, /make_interval\(days => \$\{days\}::int\)/);
  });

  it('pickups: own cédula only, daily cap, no platform fallback', () => {
    const route = readFileSync('src/app/api/shipping/correos/[action]/route.ts', 'utf8');
    assert.doesNotMatch(route, /pickupCedula\]/);
    assert.match(route, /PICKUPS_PER_DAY/);
    assert.match(route, /rateLimitAsync\(/);
  });
});
