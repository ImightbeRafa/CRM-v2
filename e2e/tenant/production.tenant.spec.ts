import { expect, test, type APIRequestContext } from '@playwright/test';

const email = process.env.BETSY_V2_TEST_EMAIL;
const password = process.env.BETSY_V2_TEST_PASSWORD;
const writesAuthorized = process.env.BETSY_V2_TEST_WRITES_AUTHORIZED === '1';

async function signIn(request: APIRequestContext) {
  if (!email || !password || !writesAuthorized) {
    throw new Error('Dedicated tenant E2E requires BETSY_V2_TEST_EMAIL, BETSY_V2_TEST_PASSWORD, and BETSY_V2_TEST_WRITES_AUTHORIZED=1');
  }
  const csrfResponse = await request.get('/api/auth/csrf');
  const { csrfToken } = await csrfResponse.json();
  const response = await request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, callbackUrl: '/produccion', json: 'true' },
  });
  expect(response.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await signIn(request);
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
