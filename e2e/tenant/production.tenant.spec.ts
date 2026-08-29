import { expect, test, type APIRequestContext } from '@playwright/test';

const email = process.env.BETSY_V2_TEST_EMAIL;
const password = process.env.BETSY_V2_TEST_PASSWORD;
const expectedTenantId = process.env.BETSY_V2_TEST_TENANT_ID;
const writesAuthorized = process.env.BETSY_V2_TEST_WRITES_AUTHORIZED === '1';
const runToken = `V2ISO-${Date.now()}`;

async function signIn(request: APIRequestContext) {
  if (!email || !password || !expectedTenantId || !writesAuthorized) {
    throw new Error('Dedicated tenant E2E requires BETSY_V2_TEST_EMAIL, BETSY_V2_TEST_PASSWORD, BETSY_V2_TEST_TENANT_ID, and BETSY_V2_TEST_WRITES_AUTHORIZED=1');
  }
  const csrfResponse = await request.get('/api/auth/csrf');
  const { csrfToken } = await csrfResponse.json();
  const response = await request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, callbackUrl: '/produccion', json: 'true' },
  });
  expect(response.ok()).toBeTruthy();
}

async function assertIsolatedTenant(request: APIRequestContext) {
  const me = await request.get('/api/auth/me');
  expect(me.ok()).toBeTruthy();
  const meJson = await me.json();
  expect(meJson.data.email).toBe(email);
  expect(meJson.data.tenant.id).toBe(expectedTenantId);
  expect(meJson.data.membershipRole).toBe('OWNER');

  const session = await request.get('/api/auth/session');
  expect(session.ok()).toBeTruthy();
  const sessionJson = await session.json();
  expect(sessionJson.user.email).toBe(email);
  expect(sessionJson.user.tenantId).toBe(expectedTenantId);
  expect(sessionJson.user.allTenantIds).toEqual([expectedTenantId]);
  expect(sessionJson.user.isLogisticsAdmin).toBeFalsy();
}

test.beforeEach(async ({ request }) => {
  await signIn(request);
  await assertIsolatedTenant(request);
});

test('dedicated tenant exposes server-driven production and clients only when ready', async ({ request }) => {
  const metadata = await request.get('/api/production/metadata');
  expect(metadata.ok()).toBeTruthy();
  const metadataJson = await metadata.json();
  expect(metadataJson.data.enabled).toBe(true);

  const orders = await request.get('/api/production/orders?view=list&limit=20');
  expect(orders.ok()).toBeTruthy();
  const ordersJson = await orders.json();
  expect(ordersJson.data.items.length).toBeLessThanOrEqual(20);
  expect(ordersJson.data.pageInfo).toHaveProperty('nextCursor');

  const clients = await request.get('/api/config/automatic-clients/v2?limit=20');
  expect(clients.ok()).toBeTruthy();
  const clientsJson = await clients.json();
  expect(clientsJson.data.items.length).toBeLessThanOrEqual(20);
});

test('isolated tenant can create a pickup order, change status, and archive it', async ({ request }) => {
  const create = await request.post('/api/orders', {
    data: {
      orderId: runToken,
      orderType: 'RA',
      status: 'Pendiente',
      customerName: `V2 Isolated ${runToken}`,
      phone: '88880001',
      email: `order-${runToken.toLowerCase()}@betsycrm.test`,
      product: 'V2TEST Pickup',
      quantity: 1,
      total: 1500,
      productCost: 1500,
    },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const created = await create.json();
  const order = created.data;
  expect(order.tenantId).toBe(expectedTenantId);
  expect(order.orderType).toBe('RA');
  expect(order.clientId).toBeTruthy();
  expect(order.lifecycleVersion).toBe(2);

  const metadata = await request.get('/api/production/metadata');
  const metadataJson = await metadata.json();
  expect(metadataJson.data.enabled).toBe(true);
  const nextStatus = metadataJson.data.statuses.find((status: { label: string }) => status.label === 'En Proceso')
    || metadataJson.data.statuses.find((status: { label: string }) => status.label !== order.status);

  const statusRes = await request.post('/api/orders/status', {
    data: {
      orderId: order.orderId,
      status: nextStatus.label,
      expectedStatus: order.status,
      expectedUpdatedAt: order.updatedAt,
      idempotencyKey: `${runToken}-status-1`,
    },
  });
  expect(statusRes.ok(), await statusRes.text()).toBeTruthy();

  const setup = await request.get('/api/setup/progress');
  expect(setup.ok()).toBeTruthy();
  const setupJson = await setup.json();
  expect(setupJson.enabled).toBe(true);

  const stats = await request.get('/api/estadisticas/v2/overview?startDate=2026-01-01&endDate=2026-12-31');
  expect(stats.ok(), await stats.text()).toBeTruthy();

  const archive = await request.delete(`/api/sales?id=${order.id}`);
  expect(archive.ok(), await archive.text()).toBeTruthy();
  const archived = await archive.json();
  expect(archived.data?.archived === true || /archiv/i.test(String(archived.message || ''))).toBeTruthy();
});
