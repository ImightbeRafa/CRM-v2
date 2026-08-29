import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const guardedTenantRoutes = [
  'src/app/api/audit/bulk-delete/route.ts',
  'src/app/api/audit/logs/[id]/restore/route.ts',
  'src/app/api/bulk/delete/route.ts',
  'src/app/api/bulk/toggle-active/route.ts',
  'src/app/api/bulk/update/route.ts',
  'src/app/api/bot/access-code/route.ts',
  'src/app/api/bot/telegram/connect/route.ts',
  'src/app/api/bot/telegram/sessions/route.ts',
  'src/app/api/chat/send/route.ts',
  'src/app/api/config/automatic-clients/route.ts',
  'src/app/api/config/automatic-clients/sync/route.ts',
  'src/app/api/config/automatic-clients/update-from-order/route.ts',
  'src/app/api/config/business-info/route.ts',
  'src/app/api/config/fields/route.ts',
  'src/app/api/config/frequent-customers/route.ts',
  'src/app/api/config/frequent-products/route.ts',
  'src/app/api/config/inventory/route.ts',
  'src/app/api/config/option-sets/route.ts',
  'src/app/api/config/options/route.ts',
  'src/app/api/config/sellers/route.ts',
  'src/app/api/config/settings/route.ts',
  'src/app/api/config/shipping-config/route.ts',
  'src/app/api/config/shipping/route.ts',
  'src/app/api/config/status/reorder/route.ts',
  'src/app/api/config/status/route.ts',
  'src/app/api/import/excel/route.ts',
  'src/app/api/integration/guia/generate/route.ts',
  'src/app/api/invoices/[id]/email/route.ts',
  'src/app/api/invoices/bulk-generate/route.ts',
  'src/app/api/invoices/generate/route.ts',
  'src/app/api/orders/confirm-payment/route.ts',
  'src/app/api/orders/route.ts',
  'src/app/api/orders/status/route.ts',
  'src/app/api/orders/update/route.ts',
  'src/app/api/sales/route.ts',
  'src/app/api/seed-frequent-data/route.ts',
  'src/app/api/setup/wizard-complete/route.ts',
  'src/app/api/setup/progress/route.ts',
  'src/app/api/shipping/generate-guia/route.ts',
  'src/app/api/shipping/guias/manual/route.ts',
  'src/app/api/social/link/route.ts',
  'src/app/api/social/subscribe/route.ts',
  'src/app/api/social/unlink/route.ts',
  'src/app/api/tenant/profile/route.ts',
  'src/app/api/users/[id]/route.ts',
  'src/app/api/users/route.ts',
  'src/app/api/webhook-logs/route.ts',
] as const;

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('regular-tenant write guard coverage', () => {
  for (const route of guardedTenantRoutes) {
    it(`${route} uses the shared DB-backed guard`, () => {
      const contents = source(route);
      assert.match(contents, /authenticateAPI|guardTenantWrite/);
    });
  }

  it('the website intake is the explicit restriction exception with backlog marking', () => {
    const contents = source('src/app/api/integration/orders/create/route.ts');
    assert.match(contents, /evaluateTenantAccess/);
    assert.match(contents, /markRestrictedBacklog/);
    assert.doesNotMatch(contents, /return guard\.response/);
  });

  it('bot business tools recheck billing immediately before execution', () => {
    const contents = source('src/lib/bot/ai-tools.ts');
    assert.match(contents, /WRITE_TOOLS/);
    assert.match(contents, /guardTenantWrite/);
    assert.ok(contents.indexOf('guardTenantWrite') < contents.lastIndexOf('executor('));
  });

  it('page middleware does not treat JWT billing claims as authoritative', () => {
    const contents = source('src/middleware.ts');
    assert.doesNotMatch(contents, /trialEndsAt[\s\S]*redirect|subscriptionStatus[\s\S]*redirect/);
  });
});
