import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { deletedExternalOrderEntityNames, shouldSkipDeletedExternalOrder } from '../external-order-tombstone';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('external order tombstone', () => {
  it('matches bulk-delete, archive, and sales-delete entityName variants', () => {
    assert.deepEqual(
      deletedExternalOrderEntityNames('ORD-1788129833824-8741'),
      [
        'ORD-1788129833824-8741',
        'Order #ORD-1788129833824-8741',
        'Sale #ORD-1788129833824-8741',
      ],
    );
  });

  it('skips recreate and post-delete resurrections, but keeps a restored original', () => {
    const deletedAt = new Date('2026-08-31T19:27:50.681Z');
    assert.equal(shouldSkipDeletedExternalOrder({ liveCreatedAt: null, deletedAt }), true);
    assert.equal(shouldSkipDeletedExternalOrder({
      liveCreatedAt: new Date('2026-08-31T21:02:57.044Z'),
      deletedAt,
    }), true);
    assert.equal(shouldSkipDeletedExternalOrder({
      liveCreatedAt: new Date('2026-08-30T22:43:54.842Z'),
      deletedAt,
    }), false);
    assert.equal(shouldSkipDeletedExternalOrder({
      liveCreatedAt: new Date('2026-08-31T21:02:57.044Z'),
      deletedAt: null,
    }), false);
  });

  it('website intake skips recreate when a delete audit exists for the orderId', () => {
    const route = source('src/app/api/integration/orders/create/route.ts');
    assert.match(route, /findDeletedExternalOrderAudit/);
    assert.match(route, /shouldSkipDeletedExternalOrder/);
    assert.match(route, /skippedDeleted: true/);
    assert.match(route, /ORDER_SKIPPED_DELETED/);
    assert.match(route, /ExternalOrderDeletedError/);
    assert.match(route, /shouldSkipDeletedExternalOrder[\s\S]*existingOrder[\s\S]*createdOrder = await createExternalOrder/);
  });

  it('lifecycle create treats a leftover idempotency key without an order as deleted', () => {
    const lifecycle = source('src/lib/order-lifecycle.ts');
    assert.match(lifecycle, /ExternalOrderDeletedError/);
    assert.match(lifecycle, /if \(replay && !replay\.order\)/);
    assert.match(lifecycle, /if \(raced && !raced\.order\)/);
  });
});
