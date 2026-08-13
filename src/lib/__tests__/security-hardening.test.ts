import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  neutralizeCsvFormula,
  timingSafeEqualString,
} from '../security';
import { redactIntegrationLogData } from '../integration-logs';
import {
  isManagedTenantId,
  resolveManagedTenantFilter,
} from '../logistics-managed-tenants';

describe('security helpers', () => {
  it('timingSafeEqualString matches equal secrets', () => {
    assert.equal(timingSafeEqualString('secret-value', 'secret-value'), true);
    assert.equal(timingSafeEqualString('secret-value', 'other-value'), false);
    assert.equal(timingSafeEqualString('', 'x'), false);
  });

  it('neutralizeCsvFormula prefixes formula-like cells', () => {
    assert.equal(neutralizeCsvFormula('=HYPERLINK("http://x")'), "'=HYPERLINK(\"http://x\")");
    assert.equal(neutralizeCsvFormula('+cmd'), "'+cmd");
    assert.equal(neutralizeCsvFormula('-1+1'), "'-1+1");
    assert.equal(neutralizeCsvFormula('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(neutralizeCsvFormula('normal text'), 'normal text');
  });

  it('redactIntegrationLogData strips PII keys', () => {
    const redacted = redactIntegrationLogData({
      errors: [{ path: ['email'] }],
      body: {
        email: 'user@example.com',
        phone: '8888-8888',
        product: 'Widget',
      },
    }) as any;
    assert.equal(redacted.body.email, '[REDACTED]');
    assert.equal(redacted.body.phone, '[REDACTED]');
    assert.equal(redacted.body.product, 'Widget');
  });
});

describe('logistics managed tenants', () => {
  it('rejects unmanaged tenant ids', () => {
    assert.equal(isManagedTenantId('not-a-managed-tenant'), false);
    assert.equal(resolveManagedTenantFilter('not-a-managed-tenant').ok, false);
  });

  it('defaults to managed set when no tenant requested', () => {
    const resolved = resolveManagedTenantFilter(null);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.ok(typeof resolved.tenantId === 'object' && 'in' in resolved.tenantId);
    }
  });

  it('includes Forge in the logistics allowlist', () => {
    assert.equal(isManagedTenantId('cmsrgct420000vipcp3xyqb0m'), true);
    const resolved = resolveManagedTenantFilter('cmsrgct420000vipcp3xyqb0m');
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.tenantId, 'cmsrgct420000vipcp3xyqb0m');
    }
  });

  it('keeps Bloom in the logistics allowlist', () => {
    assert.equal(isManagedTenantId('cmm4pv8fl0000jr045en1nik9'), true);
  });
});
