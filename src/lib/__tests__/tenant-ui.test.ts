import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCustomerPaste } from '@/lib/customer-paste';
import { firstIncompleteSetupStep, safeSetupReturnTo } from '@/lib/setup-progress';
import { buildStatisticsV2Overview, type StatisticsV2Order } from '@/lib/statistics-v2';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const emptyCustomer = {
  name: '', phone: '', email: '', username: '', province: '', canton: '', district: '', address: '',
};

describe('Betsy v2 tenant UI', () => {
  it('keeps the heuristic parser immediate and tolerant of labeled text', () => {
    const parsed = parseCustomerPaste(
      'Nombre: Ana Pérez\nTeléfono: 8888-7777\nCorreo: ana@example.com\nProvincia/Cantón/Distrito: Alajuela, Alajuela, Carrizal',
      emptyCustomer,
    );
    assert.equal(parsed.phone, '88887777');
    assert.equal(parsed.email, 'ana@example.com');
    assert.equal(parsed.province, 'Alajuela');
    assert.equal(parsed.canton, 'Alajuela');
    assert.equal(parsed.district, 'Carrizal');
  });

  it('rejects external and Logistics setup return targets', () => {
    assert.equal(safeSetupReturnTo('/config?tab=inventory'), '/config?tab=inventory');
    assert.equal(safeSetupReturnTo('//evil.example'), '/dashboard');
    assert.equal(safeSetupReturnTo('%2F%2Fevil.example'), '/dashboard');
    assert.equal(safeSetupReturnTo('/logistics/orders'), '/dashboard');
    assert.equal(firstIncompleteSetupStep(['welcome-business'], ['shipping-correos']), 'order-status');
  });

  it('keeps setup SQL additive and away from Logistics tables', () => {
    const sql = source('supabase/migrations/023_betsy_v2_tenant_ui.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS (?:public\.)?"TenantSetupProgress"/);
    assert.doesNotMatch(sql, /DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|lm_/i);
  });

  it('does not count Pendiente unpaid orders as collected revenue', () => {
    const base = { orderType: 'EA', status: 'Pendiente', customerName: 'V2TEST Ana', saleDate: '2026-08-01', seller: null, salesChannel: null };
    const orders: StatisticsV2Order[] = [
      { ...base, id: '1', orderId: 'A', total: 100, timestamp: new Date('2026-08-01T12:00:00Z'), contraEntrega: false, cePaymentConfirmed: false },
      { ...base, id: '2', orderId: 'B', total: 200, timestamp: new Date('2026-08-01T13:00:00Z'), contraEntrega: true, cePaymentConfirmed: false },
      { ...base, id: '3', orderId: 'C', total: 300, timestamp: new Date('2026-08-01T14:00:00Z'), contraEntrega: true, cePaymentConfirmed: true },
    ];
    const overview = buildStatisticsV2Overview(orders, new Map(), new Date('2026-08-02T00:00:00Z'));
    assert.equal(overview.revenue.bookedGross, 600);
    assert.equal(overview.revenue.bookedCodGross, 500);
    assert.equal(overview.revenue.collectedCod, 300);
    assert.equal(overview.revenue.pendingCod, 200);
    assert.equal(overview.revenue.collectedRevenue, 300);
    assert.equal(overview.summary.totalRevenue, 600);
    assert.equal(overview.topCustomers.topCustomersByRevenue[0].customerStatus, 'Muy activo');
  });

  it('keeps AI enhancement off the order form and non-writing if the API is called', () => {
    const server = source('src/lib/customer-paste-grok.ts');
    const route = source('src/app/api/ventas/customer-paste/enhance/route.ts');
    const form = source('src/app/ventas/components/EnhancedSalesForm.tsx');
    const customerForm = source('src/app/ventas/components/customerForm.tsx');
    assert.match(server, /buildXaiResponseBody/);
    assert.match(source('src/lib/bot/xai-responses.ts'), /store:\s*false/);
    assert.match(server, /maxRetries:\s*0/);
    assert.doesNotMatch(server + route, /from ['"][^'"]*(order-lifecycle|\/db|prisma|inventory|invoice)/i);
    assert.match(route, /createIdentifierRateLimit/);
    assert.match(route, /readTenantUiReadiness/);
    assert.doesNotMatch(form + customerForm, /Mejorar con Grok/);
    assert.doesNotMatch(form, /Revisa o descarta la sugerencia de Grok/);
  });

  it('resolves real config tab IDs instead of stale aliases', () => {
    const config = source('src/app/config/page.tsx');
    assert.match(config, /'inventory'/);
    assert.match(config, /'shipping-config'/);
    assert.match(config, /router\.replace/);
  });

  it('uses Spanish order-form copy and a /pedidos redirect', () => {
    const form = source('src/app/ventas/components/EnhancedSalesForm.tsx');
    const toggle = source('src/app/ventas/components/OrderTypeToggle.tsx');
    const config = source('next.config.js');
    assert.match(form, /Nuevo pedido/);
    assert.doesNotMatch(form, /Sistema de Ventas Optimizado/);
    assert.match(toggle, />\s*Envío\s*</);
    assert.match(toggle, />\s*Retiro\s*</);
    assert.doesNotMatch(toggle, /Envío \(EA\)/);
    assert.match(config, /source: '\/pedidos'/);
    assert.match(config, /destination: '\/ventas'/);
  });

  it('unlocks Preview v2 for every tenant and never unlocks production', () => {
    const env = source('src/lib/review-environment.ts');
    const flags = source('src/lib/feature-flags.ts');
    const billing = source('src/lib/billing-access.ts');
    const layout = source('src/app/layout.tsx');
    assert.match(env, /arePreviewFeaturesUnlockedForTenant/);
    assert.match(env, /VERCEL_ENV === 'production'/);
    assert.match(flags, /arePreviewFeaturesUnlockedForTenant/);
    assert.match(billing, /arePreviewFeaturesUnlockedForTenant/);
    assert.match(layout, /shouldShowPreviewDataWarning/);
    assert.doesNotMatch(flags, /arePreviewFeaturesUnlocked\(\)/);
    assert.doesNotMatch(billing, /arePreviewFeaturesUnlocked\(\)/);
    assert.doesNotMatch(layout, /arePreviewFeaturesUnlocked\(\)/);
  });

  it('loads estadisticas v2 via period aggregates instead of hydrating every order', () => {
    const route = source('src/app/api/estadisticas/v2/overview/route.ts');
    const aggregates = source('src/lib/statistics-period-query.ts');
    const dashboard = source('src/app/estadisticas/components/EstadisticasDashboard.tsx');
    assert.match(route, /fetchStatisticsV2PeriodOverview/);
    assert.doesNotMatch(route, /take:\s*25_001/);
    assert.match(aggregates, /GROUP BY/);
    assert.match(aggregates, /tenantId/);
    assert.match(aggregates, /STATS_ORDER_DETAILS_CAP/);
    assert.match(dashboard, /if \(statisticsV2\.enabled\)/);
    assert.match(dashboard, /\/api\/estadisticas\/v2\/overview/);
  });

  it('caps producción default list at 100 updatedAt rows in SQL', () => {
    const productionRoute = source('src/app/api/production/orders/route.ts');
    const hook = source('src/app/hooks/useProductionServer.ts');
    const dashboard = source('src/app/produccion/components/EnhancedProductionDashboard.tsx');
    const legacy = source('src/app/hooks/useSalesStream.ts');
    assert.match(productionRoute, /updatedAt:\s*'desc'/);
    assert.match(productionRoute, /PRODUCTION_LIST_DEFAULT_LIMIT/);
    assert.match(hook, /view === 'column' \? 20 : 100/);
    assert.match(dashboard, /limit:\s*100/);
    assert.match(dashboard, /sortBy:\s*'updatedAt'/);
    assert.doesNotMatch(legacy, /limit:\s*['"]all['"].*Producci/);
  });
});
