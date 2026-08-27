import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  decodeTimestampCursor,
  encodeTimestampCursor,
  hashCursorScope,
  normalizeStoredStatus,
  parsePageLimit,
} from '../cursor-pagination';
import { buildProductionWhere, groupStatusCounts, parseProductionQuery, productionCursorScope } from '../production-query';
import { buildClientWhere, clientCursorScope, parseClientQuery } from '../client-query';

test('signed cursor round-trips only inside its filter scope', () => {
  const scope = hashCursorScope({ status: 'pending', search: 'ana' });
  const cursor = encodeTimestampCursor({ timestamp: '2026-08-27T12:00:00.000Z', id: 'order-b' }, scope);
  assert.deepEqual(decodeTimestampCursor(cursor, scope), { timestamp: '2026-08-27T12:00:00.000Z', id: 'order-b' });
  assert.throws(() => decodeTimestampCursor(cursor, hashCursorScope({ status: 'sent', search: 'ana' })), /Invalid cursor/);
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`;
  assert.throws(() => decodeTimestampCursor(tampered, scope), /Invalid cursor/);
});

test('page limits and query inputs reject unsafe values', () => {
  assert.equal(parsePageLimit(null, 50), 50);
  assert.equal(parsePageLimit('100', 50), 100);
  assert.throws(() => parsePageLimit('0', 50), /between/);
  assert.throws(() => parsePageLimit('all', 50), /Invalid limit/);
  assert.throws(() => parseProductionQuery(new URLSearchParams({ search: 'a' })), /at least 2/);
  assert.throws(() => parseClientQuery(new URLSearchParams({ state: 'deleted' })), /Invalid client state/);
});

test('production filters are cursor-bound and preserve unclassified work', () => {
  const input = parseProductionQuery(new URLSearchParams({ view: 'list', search: 'Ana', orderType: 'EA' }));
  const pending = { id: 's1', label: 'Pendiente' };
  const scope = productionCursorScope(input, pending, 'revision-1');
  assert.notEqual(scope, productionCursorScope(input, pending, 'revision-2'));
  const where = buildProductionWhere({
    input,
    configuredStatuses: [pending],
    selectedStatus: pending,
    terminalClassifications: [{ statusValue: 'Entregado', isTerminal: true }],
    terminalFilteringEnabled: true,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.ok(Array.isArray(where.AND));
  assert.match(JSON.stringify(where), /Pendiente/);
  assert.doesNotMatch(JSON.stringify(where), /Entregado/);
});

test('unknown statuses have their own count instead of falling into first column', () => {
  const grouped = groupStatusCounts([
    { status: 'Pendiente', _count: { _all: 4 } },
    { status: 'Estado antiguo', _count: { _all: 3 } },
  ], [{ id: 'pending', label: 'Pendiente' }]);
  assert.deepEqual(grouped, { counts: { pending: 4 }, unconfigured: 3 });
  assert.equal(normalizeStoredStatus('  Pendíente  '), 'pendiente');
});

test('terminal retention keeps unknown and non-terminal values visible', () => {
  const input = parseProductionQuery(new URLSearchParams({ view: 'list' }));
  const where = buildProductionWhere({
    input,
    configuredStatuses: [{ id: 'pending', label: 'Pendiente' }],
    selectedStatus: null,
    terminalClassifications: [
      { statusValue: 'Pendiente', isTerminal: false },
      { statusValue: 'Entregado', isTerminal: true },
    ],
    terminalFilteringEnabled: true,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  const serialized = JSON.stringify(where);
  assert.match(serialized, /Entregado/);
  assert.match(serialized, /2026-07-28/);
  assert.doesNotMatch(serialized, /Estado antiguo/);
});

test('approved terminal Kanban columns are also limited to 30 days', () => {
  const input = parseProductionQuery(new URLSearchParams({ view: 'column', statusId: 'delivered' }));
  const delivered = { id: 'delivered', label: 'Entregado' };
  const where = buildProductionWhere({
    input,
    configuredStatuses: [delivered],
    selectedStatus: delivered,
    terminalClassifications: [{ statusValue: 'ENTREGADO', isTerminal: true }],
    terminalFilteringEnabled: true,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.match(JSON.stringify(where), /2026-07-28/);
});

test('client filters and cursors are server-scoped', () => {
  const input = parseClientQuery(new URLSearchParams({ search: 'Ana', province: 'San José', state: 'inactive' }));
  const where = buildClientWhere(input);
  assert.match(JSON.stringify(where), /isActive/);
  assert.notEqual(clientCursorScope(input), clientCursorScope({ ...input, state: 'active' }));
});

test('slice 4 static safety contracts remain in place', async () => {
  const [productionHook, board, statusRoute, configContext, migration, classificationScript, historyRoute, exportRoute] = await Promise.all([
    readFile('src/app/hooks/useProductionServer.ts', 'utf8'),
    readFile('src/app/produccion/components/KanbanBoard.tsx', 'utf8'),
    readFile('src/app/api/orders/status/route.ts', 'utf8'),
    readFile('src/app/contexts/ConfigContext.tsx', 'utf8'),
    readFile('supabase/migrations/020_betsy_v2_server_pagination.sql', 'utf8'),
    readFile('scripts/betsy-v2-terminal-statuses.ts', 'utf8'),
    readFile('src/app/api/config/automatic-clients/[id]/orders/route.ts', 'utf8'),
    readFile('src/app/api/exports/clients/route.ts', 'utf8'),
  ]);
  assert.doesNotMatch(productionHook, /limit:\s*['"]all/);
  assert.doesNotMatch(board, /DndContext|useSortable|DragOverlay/);
  assert.match(board, /Sin configurar/);
  assert.match(statusRoute, /expectedUpdatedAt/);
  assert.match(statusRoute, /STALE_ORDER/);
  assert.match(configContext, /`\$\{tenantKey\}:\$\{key\}`/);
  assert.match(configContext, /activeTenantRef/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS/);
  assert.doesNotMatch(migration, /(^|\n)\s*(DROP|TRUNCATE|DELETE)\s/im);
  assert.match(classificationScript, /BETSY_V2_TERMINAL_MAPPING_APPROVED_TENANT/);
  assert.match(classificationScript, /--mapping/);
  assert.match(historyRoute, /clientId: id/);
  assert.doesNotMatch(historyRoute, /phone|customerName/);
  assert.match(exportRoute, /clientId: \{ in: clientIds \}/);
  assert.doesNotMatch(exportRoute, /order\.phone === client\.phone/);
});
