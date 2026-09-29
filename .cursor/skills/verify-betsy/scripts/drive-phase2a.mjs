#!/usr/bin/env node
/**
 * Phase 2a UI proof (read-only): the Chats details panel has the Cliente · Agente tabs, the
 * Cliente tab shows chat stage + tags + client panel (+ notes when 035 is applied), and
 * Config › Chats lists the three editors. Never clicks a save / send / stage button.
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, password, readSession, report, tenantId } from './lib.mjs'

/** Like lib signIn, but waits for hydration first (the dev server loads the form's JS lazily). */
async function signIn(page) {
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.getByRole('heading', { name: /iniciar sesión/i }).waitFor({ timeout: 25_000 })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
}

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const browser = await launchBrowser()
const checks = {}
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const page = await context.newPage()
  await signIn(page)
  const session = await readSession(page)
  checks.isolatedTenant = session?.tenantId === tenantId
  if (!checks.isolatedTenant) report('AUTH_BLOCKED', { reason: 'wrong tenant', checks })

  await page.goto(`${baseUrl}/chats`, { waitUntil: 'networkidle', timeout: 120_000 })
  const row = page.locator('button[data-soft-conv-key]:visible').first()
  await row.waitFor({ timeout: 90_000 })
  await page.screenshot({ path: path.join(evidenceDir, 'phase2a-chats-list.png') })
  await row.click()
  await page.locator('[data-testid="chat-context-rail"]').first().waitFor({ timeout: 60_000 }).catch(() => undefined)
  await page.locator('[data-testid="chat-client-panel"], [data-testid="chat-client-unlinked"]').first().waitFor({ timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(3000)
  checks.contextRail = (await page.locator('[data-testid="chat-context-rail"]').count()) > 0
  checks.tabCliente = (await page.locator('[data-testid="rail-tab-cliente"]').count()) > 0
  checks.tabAgente = (await page.locator('[data-testid="rail-tab-agente"]').count()) > 0
  checks.noOldDetalleTab = (await page.getByRole('button', { name: 'Detalle', exact: true }).count()) === 0
  checks.stagePicker = (await page.getByRole('listbox', { name: 'Etapa del chat' }).count()) > 0
  checks.clientPanel = (await page.locator('[data-testid="chat-client-panel"]').count()) > 0
  checks.notesPanel = (await page.locator('[data-testid="chat-notes-panel"]').count()) > 0
  await page.screenshot({ path: path.join(evidenceDir, 'phase2a-chats-rail-cliente.png') })

  if (checks.tabAgente) {
    await page.locator('[data-testid="rail-tab-agente"]').first().click()
    await page.waitForTimeout(800)
    checks.agenteBody = (await page.getByText('Estado del agente').count()) > 0
    await page.screenshot({ path: path.join(evidenceDir, 'phase2a-chats-rail-agente.png') })
  }

  await page.goto(`${baseUrl}/config?tab=chats`, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.locator('[data-testid="chats-config-client"] input').first().waitFor({ timeout: 90_000 }).catch(() => undefined)
  checks.configPanel = (await page.locator('[data-testid="chats-config-panel"]').count()) > 0
  checks.configChatStages = (await page.locator('[data-testid="chats-config-chat"]').count()) > 0
  checks.configClientStages = (await page.locator('[data-testid="chats-config-client"]').count()) > 0
  checks.configTags = (await page.locator('[data-testid="chats-config-tags"]').count()) > 0
  checks.clientDefaults = (await page.locator('[data-testid="chats-config-client"] input[aria-label="Nombre de la etapa"]').evaluateAll((els) => els.map((e) => e.value))).join(' → ')
  await page.screenshot({ path: path.join(evidenceDir, 'phase2a-config-chats.png'), fullPage: true })

  // Mobile width: the details sheet must use the same rail.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() })
  const m = await mobile.newPage()
  await m.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded' })
  await m.waitForTimeout(3000)
  await m.screenshot({ path: path.join(evidenceDir, 'phase2a-chats-mobile.png') })
  process.stdout.write(`${JSON.stringify({ state: 'DONE', checks })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ state: 'FAIL', message: String(error?.message || error).slice(0, 300), checks })}\n`)
  process.exitCode = 1
} finally {
  await browser.close()
}
