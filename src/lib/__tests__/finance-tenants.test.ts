import assert from 'node:assert/strict';
import {
  FINANCE_BRAND_LIST,
  FINANCE_TENANTS,
  getFinanceTenantBySlug,
  resolveFinanceTenants,
} from '@/lib/finance-tenants';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

test('allowlist includes DeepClean and Forge with stable CRM ids', () => {
  const slugs = FINANCE_TENANTS.map((t) => t.slug);
  assert.deepEqual(slugs, ['deepsleep', 'bloom', 'deepclean', 'forge']);
  assert.equal(getFinanceTenantBySlug('deepclean')?.id, 'cmln5u7k70000ld042qify2og');
  assert.equal(getFinanceTenantBySlug('forge')?.id, 'cmsrgct420000vipcp3xyqb0m');
});

test('resolveFinanceTenants accepts new slugs and rejects unknown', () => {
  assert.equal(resolveFinanceTenants('deepclean')?.length, 1);
  assert.equal(resolveFinanceTenants('forge')?.[0]?.slug, 'forge');
  assert.equal(resolveFinanceTenants('all')?.length, 4);
  assert.equal(resolveFinanceTenants('invalid'), null);
});

test('FINANCE_BRAND_LIST matches allowlist', () => {
  assert.equal(FINANCE_BRAND_LIST, 'deepsleep, bloom, deepclean, forge');
});

console.log('\nAll finance tenant tests passed.');
