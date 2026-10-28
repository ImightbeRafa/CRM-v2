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
