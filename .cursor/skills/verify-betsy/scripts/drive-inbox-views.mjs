#!/usr/bin/env node
/**
 * /chats quick views proof (read-only, isolated test tenant): the view tabs render with counts, each tab loads its
 * rows (`view=` list request), the counts come from /view-counts, the chosen tab survives a reload, and the row of
 * tabs fits a phone. Clicking a tab only writes localStorage; never sends or changes data.
 */
import path from 'node:path'
import fs from 'node:fs'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, password, report } from './lib.mjs'

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const VIEWS = ['persona', 'pago', 'pedido', 'ia', 'seguimientos']
const browser = await launchBrowser()
const checks = {}
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.getByRole('heading', { name: /iniciar sesión/i }).waitFor({ timeout: 25_000 })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 })

  const requests = []
  page.on('response', (res) => {
    const u = res.url()
    if (u.includes('/api/chat/conversations')) requests.push({ url: u.replace(baseUrl, ''), status: res.status() })
  })
  await page.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const tabs = page.locator('[data-testid="chat-view-tabs"]:visible')
  await tabs.first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(4000)
  checks.tabLabels = (await tabs.first().getByRole('tab').allTextContents()).map((t) => t.trim())
  checks.countsRequest = requests.find((r) => r.url.includes('/view-counts')) || null
  await page.screenshot({ path: path.join(evidenceDir, 'inbox-views-desktop-bandeja.png') })

  checks.views = {}
  for (const v of VIEWS) {
    await tabs.first().getByTestId(`chat-view-${v}`).click()
    await page.waitForTimeout(2500)
    checks.views[v] = {
      selected: (await tabs.first().getByTestId(`chat-view-${v}`).getAttribute('aria-selected')) === 'true',
      listRequest: requests.find((r) => r.url.includes(`view=${v}`)) || null,
      rows: await page.locator('[data-soft-conv-key]:visible').count(),
    }
    if (v === 'persona') await page.screenshot({ path: path.join(evidenceDir, 'inbox-views-desktop-persona.png') })
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await tabs.first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(3000)
  checks.rememberedAfterReload =
    (await tabs.first().getByTestId('chat-view-seguimientos').getAttribute('aria-selected')) === 'true'
  await tabs.first().getByTestId('chat-view-todos').click()
  await page.waitForTimeout(1000)

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() })
  const mp = await phone.newPage()
  await mp.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const mtabs = mp.locator('[data-testid="chat-view-tabs"]:visible')
  await mtabs.first().waitFor({ timeout: 90_000 })
  await mp.waitForTimeout(4000)
  checks.mobile = {
    tabsVisible: await mtabs.first().isVisible(),
    pageScrollsSideways: await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  }
  await mp.screenshot({ path: path.join(evidenceDir, 'inbox-views-mobile.png') })

  const ok =
    checks.tabLabels.length === 6 &&
    checks.countsRequest?.status === 200 &&
    VIEWS.every((v) => checks.views[v].selected && checks.views[v].listRequest?.status === 200) &&
    checks.rememberedAfterReload &&
    checks.mobile.tabsVisible &&
    !checks.mobile.pageScrollsSideways
  const note = [
    '# proof · inbox views',
    `- target: ${baseUrl}`,
    `- utc: ${new Date().toISOString()}`,
    `- tenant email: ${email}`,
    '- mutations: none (tab choice is localStorage only)',
    '```json',
    JSON.stringify(checks, null, 2),
    '```',
  ].join('\n')
  fs.writeFileSync(path.join(evidenceDir, 'proof-inbox-views.md'), note)
  report(ok ? 'PASS' : 'FAIL', checks)
} finally {
  await browser.close()
}
