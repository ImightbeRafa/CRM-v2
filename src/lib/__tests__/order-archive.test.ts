import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getOrderRestoreEligibility, ORDER_RESTORE_WINDOW_MS } from '../order-archive';

test('restore eligibility uses an exact 30-day window', () => {
  const deletedAt = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(
    getOrderRestoreEligibility(deletedAt, new Date(deletedAt.getTime() + ORDER_RESTORE_WINDOW_MS)).eligible,
    true,
  );
  assert.equal(
    getOrderRestoreEligibility(deletedAt, new Date(deletedAt.getTime() + ORDER_RESTORE_WINDOW_MS + 1)).eligible,
    false,
  );
});

test('schema package is additive and preserves old application compatibility', async () => {
  const [schema, migration] = await Promise.all([
    readFile('prisma/schema.prisma', 'utf8'),
    readFile('supabase/migrations/022_betsy_v2_order_archive.sql', 'utf8'),
  ]);
  for (const field of ['deletedAt', 'deletedBy', 'deleteReason', 'archiveMetadata']) {
    assert.match(schema, new RegExp(`${field}\\s+`));
    assert.match(migration, new RegExp(`"${field}"`));
  }
  assert.doesNotMatch(migration, /(^|\n)\s*(DROP|TRUNCATE|DELETE|UPDATE)\s/im);
  assert.doesNotMatch(migration, /ALTER TYPE|prisma|db push/i);
});

test('all top-level Prisma order reads and legacy mutations exclude archived rows', async () => {
  const db = await readFile('src/lib/db.ts', 'utf8');
  for (const operation of [
    'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
    'findMany', 'count', 'aggregate', 'groupBy', 'update', 'updateMany',
    'delete', 'deleteMany', 'upsert',
  ]) {
    assert.match(db, new RegExp(`${operation}\\(\\{ args, query \\}\\)`));
  }
  assert.match(db, /deletedAt: null/);
  assert.match(db, /prismaRaw/);
});

test('restore changes only the retained Order row and writes audit atomically', async () => {
  const service = await readFile('src/lib/order-archive.ts', 'utf8');
  assert.match(service, /const auditLog = await tx\.auditLog\.findFirst/);
  assert.match(service, /const order = await tx\.order\.findFirst/);
  assert.match(service, /archiveAuditLogId !== auditLog\.id/);
  assert.match(service, /deletedAt: expectedDeletedAt/);
  assert.match(service, /data:\s*\{[\s\S]*?deletedAt: null,/);
  assert.match(service, /sideEffectsReplayed: false/);
  assert.match(service, /await tx\.auditLog\.create/);
  assert.doesNotMatch(service, /tx\.(invoice|shippingGuia|inventoryItem|orderInventoryAllocation)\.(create|update|delete|upsert)/);
  assert.doesNotMatch(service, /oldValues[^\n]*\.(create|update|upsert)|newValues[^\n]*\.(create|update|upsert)/);
});

test('restore endpoint is OWNER-only, DB-guarded, flagged, versioned, and fail-closed', async () => {
  const [route, listRoute] = await Promise.all([
    readFile('src/app/api/audit/logs/[id]/restore/route.ts', 'utf8'),
    readFile('src/app/api/audit/logs/route.ts', 'utf8'),
  ]);
  assert.match(route, /auth\.role !== 'OWNER'/);
  assert.match(route, /guardTenantWrite/);
  assert.match(route, /shouldUseSoftDeleteRestoreV2/);
  assert.match(route, /expectedDeletedAt/);
  assert.match(route, /restoreOrderFromAudit/);
  assert.doesNotMatch(route, /oldValues|newValues/);
  assert.match(listRoute, /archivedByAuditId/);
  assert.match(listRoute, /archiveAuditLogId/);
});

test('order delete adapters archive only behind the one tenant flag', async () => {
  const [bulk, sales, flags] = await Promise.all([
    readFile('src/lib/bulkOperations.ts', 'utf8'),
    readFile('src/app/api/sales/route.ts', 'utf8'),
    readFile('src/lib/feature-flags.ts', 'utf8'),
  ]);
  assert.match(bulk, /shouldUseSoftDeleteRestoreV2/);
  assert.match(bulk, /archiveOrder\(/);
  assert.match(sales, /shouldUseSoftDeleteRestoreV2/);
  assert.match(sales, /archiveOrder\(/);
  assert.match(flags, /soft_delete_restore_v2/);
});
