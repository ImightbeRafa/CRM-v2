import { expect, test } from '@playwright/test';

test('public shell and sign-in render from the production build', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  await page.goto('/auth/signin');
  await expect(page.locator('body')).toBeVisible();
});

test('regular-tenant pages redirect an unauthenticated visitor', async ({ page }) => {
  await page.goto('/produccion');
  await expect(page).toHaveURL(/\/auth\/signin/);
  await page.goto('/config?tab=clients');
  await expect(page).toHaveURL(/\/auth\/signin/);
});

test('new read APIs and stale-safe mutation fail closed without a session', async ({ request }) => {
  for (const path of [
    '/api/production/metadata',
    '/api/production/orders?view=list&limit=20',
    '/api/production/summary',
    '/api/config/automatic-clients/v2?limit=20',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
  }
  const mutation = await request.post('/api/orders/status', {
    data: { orderId: 'V2TEST-NOT-REAL', status: 'Pendiente' },
  });
  expect(mutation.status()).toBe(401);
});
