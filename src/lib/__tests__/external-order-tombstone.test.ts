import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { deletedExternalOrderEntityNames } from '../external-order-tombstone';

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

  it('website intake skips recreate when a delete audit exists for the orderId', () => {
    const route = source('src/app/api/integration/orders/create/route.ts');
    assert.match(route, /findDeletedExternalOrderAudit/);
    assert.match(route, /skippedDeleted: true/);
    assert.match(route, /ORDER_SKIPPED_DELETED/);
    assert.match(route, /ExternalOrderDeletedError/);
    assert.match(route, /existingOrder[\s\S]*deletedAudit[\s\S]*createdOrder = await createExternalOrder/);
  });

  it('lifecycle create treats a leftover idempotency key without an order as deleted', () => {
    const lifecycle = source('src/lib/order-lifecycle.ts');
    assert.match(lifecycle, /ExternalOrderDeletedError/);
    assert.match(lifecycle, /if \(replay && !replay\.order\)/);
    assert.match(lifecycle, /if \(raced && !raced\.order\)/);
  });
});
