import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const form = readFileSync('src/app/ventas/components/EnhancedSalesForm.tsx', 'utf8')
const clientRoute = readFileSync('src/app/api/config/automatic-clients/update-from-order/route.ts', 'utf8')

test('saving an order never waits on the tenant-wide client sync', () => {
  // The full sync loops every customer of the business; it hung the drawer for minutes.
  assert.doesNotMatch(form, /automatic-clients\/sync/)
})

test('customer bookkeeping runs in the background after the order is saved', () => {
  assert.match(form, /void fetch\('\/api\/config\/automatic-clients\/update-from-order'/)
  assert.match(form, /keepalive: true/)
  assert.doesNotMatch(form, /await fetch\('\/api\/config\/automatic-clients\/update-from-order'/)
})

test('a double click cannot submit twice (synchronous guard)', () => {
  assert.match(form, /if \(submittingRef\.current\) return;\s+submittingRef\.current = true;/)
  assert.match(form, /finally \{\s+submittingRef\.current = false;/)
})

test('per-order client update refreshes that customer stats, tenant-scoped', () => {
  assert.match(clientRoute, /prisma\.order\.aggregate\(\{\s+(?:\/\/.*\s+)?where: \{ tenantId, phone: /)
  assert.match(clientRoute, /\.\.\.stats,\s+lastUpdated/)
})

test('a retry of the same draft re-sends the same order id and cannot duplicate', () => {
  assert.match(form, /orderId: \(draftOrderIdRef\.current \?\?= `ORDER-\$\{Date\.now\(\)\}`\)/)
  assert.match(form, /'Idempotency-Key': `ventas:create:\$\{orderData\.orderId\}`/)
  assert.match(form, /draftOrderIdRef\.current = null;/)
  assert.match(form, /signal: AbortSignal\.timeout\(45_000\)/)
  // HTML gateway errors must not surface as "Unexpected token <"
  assert.match(form, /await response\.json\(\)\.catch\(/)
  const orders = readFileSync('src/app/api/orders/route.ts', 'utf8')
  assert.match(orders, /if \(already\) return createSuccessResponse\(already, 'Order already created'\)/)
})

test('client stats never drop to zero on a phone mismatch; trimmed phone matches too', () => {
  assert.match(clientRoute, /phone: \{ in: Array\.from\(new Set\(\[phone, phone\.trim\(\)\]\)\) \}/)
  assert.match(clientRoute, /computed\.totalOrders > 0 \? computed : \{\}/)
})

test('the drawer closes as soon as the order exists (chat link runs after)', () => {
  const drawer = readFileSync('src/components/aurora/pedidos/CrearPedidoDrawer.tsx', 'utf8')
  assert.match(drawer, /onOpenChange\(false\)\s+void Promise\.resolve\(\)\s+\.then\(\(\) => onCreated\?\.\(order\)\)/)
})
