import { expect, test } from '@playwright/test';
import path from 'node:path';

const email = process.env.BETSY_V2_TEST_EMAIL;
const password = process.env.BETSY_V2_TEST_PASSWORD;
const expectedTenantId = process.env.BETSY_V2_TEST_TENANT_ID;
const writesAuthorized = process.env.BETSY_V2_TEST_WRITES_AUTHORIZED === '1';
const origin = process.env.BETSY_V2_UI_ORIGIN || 'http://localhost:3000';
const artifactDir = process.env.BETSY_V2_UI_ARTIFACT_DIR || '';

test.use({ baseURL: origin });

test.beforeEach(async () => {
  if (!email || !password || !expectedTenantId || !writesAuthorized) {
    throw new Error('Dedicated tenant UI E2E requires BETSY_V2_TEST_EMAIL, BETSY_V2_TEST_PASSWORD, BETSY_V2_TEST_TENANT_ID, and BETSY_V2_TEST_WRITES_AUTHORIZED=1');
  }
});

test('isolated tenant can sign in through /auth/signin and open ventas and produccion', async ({ page }) => {
  await page.goto('/auth/signin');
  await expect(page.getByRole('heading', { name: 'Iniciar Sesión' })).toBeVisible();
  await page.getByLabel('Correo Electrónico').fill(email!);
  await page.locator('input[type="password"]').fill(password!);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  const session = await page.request.get('/api/auth/session');
  expect(session.ok()).toBeTruthy();
  const sessionJson = await session.json();
  expect(sessionJson.user.email).toBe(email);
  expect(sessionJson.user.tenantId).toBe(expectedTenantId);

  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, 'ui_dashboard_after_signin.png'), fullPage: true });
  }

  await page.goto('/ventas');
  await expect(page).toHaveURL(/\/ventas/);
  await expect(page.locator('body')).toBeVisible();
  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, 'ui_ventas_isolated_tenant.png'), fullPage: true });
  }

  await page.goto('/produccion');
  await expect(page).toHaveURL(/\/produccion/);
  await expect(page.locator('body')).toBeVisible();
  if (artifactDir) {
    await page.screenshot({ path: path.join(artifactDir, 'ui_produccion_isolated_tenant.png'), fullPage: true });
  }
});
