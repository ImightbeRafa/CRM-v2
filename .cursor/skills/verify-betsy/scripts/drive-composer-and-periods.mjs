#!/usr/bin/env node
/**
 * Isolated test tenant only. (1) Chats composer stays writable while a text send is in flight:
 * /api/chat/send is intercepted in the browser (held 4 s, then a fake failure) so NOTHING reaches
 * WhatsApp / Instagram. (2) Estadísticas period picker: Esta semana, Mes pasado, custom range.
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, report, password } from './lib.mjs'

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const browser = await launchBrowser()
const checks = {}
let page = null
const shot = (name) => page.screenshot({ path: path.join(evidenceDir, name) })
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  page = await context.newPage()
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.getByRole('heading', { name: /iniciar sesión/i }).waitFor({ timeout: 25_000 })
  await page.waitForTimeout(2500) // hydration: earlier fills get wiped
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 })

  // ── 1. Composer while sending (fake, intercepted send) ──
  const sends = []
  await page.route('**/api/chat/send', async (route) => {
    sends.push(JSON.parse(route.request().postData() || '{}').content)
    await new Promise((r) => setTimeout(r, 4000))
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'prueba (interceptado)' }) })
  })
  await page.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(8000)
  await page.locator('button[data-soft-conv-key]:visible').first().click({ timeout: 20_000 })
  const box = page.getByTestId('composer-textarea').first()
  await box.waitFor({ timeout: 30_000 })
  checks.composerEnabledAtStart = await box.isEnabled()
  if (checks.composerEnabledAtStart) {
    await box.fill('prueba uno (no se envía)')
    await box.press('Enter')
    await page.waitForTimeout(400)
    checks.enabledWhileSending = await box.isEnabled()
    await box.type('prueba dos')
    checks.typedWhileSending = await box.inputValue()
    await box.press('Enter')
    await page.waitForTimeout(400)
    await shot('composer-while-sending.png')
    await page.waitForTimeout(9000)
    checks.sendsInOrder = sends
  }
  await page.unroute('**/api/chat/send')

  // ── 2. Estadísticas periods ──
  const summaryCalls = []
  page.on('response', (res) => {
    if (res.url().includes('/api/estadisticas/aurora-summary')) summaryCalls.push({ q: new URL(res.url()).search, status: res.status() })
  })
  const firstSummary = page.waitForResponse((res) => res.url().includes('/api/estadisticas/aurora-summary?period=semana'), { timeout: 90_000 })
  await page.goto(`${baseUrl}/estadisticas?periodo=semana`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  const semanaRes = await firstSummary
  summaryCalls.push({ q: new URL(semanaRes.url()).search, status: semanaRes.status() })
  await page.getByTestId('stats-period-range').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  checks.semanaRange = await page.getByTestId('stats-period-range').textContent()
  await shot('stats-semana.png')
  await page.getByRole('tab', { name: 'Mes pasado' }).click()
  await page.waitForTimeout(3000)
  checks.mesPasadoRange = await page.getByTestId('stats-period-range').textContent()
  await page.getByTestId('stats-period-more').click()
  await page.getByLabel('Desde').fill('2026-09-01')
  await page.getByLabel('Hasta').fill('2026-09-15')
  await shot('stats-custom-panel.png')
  await page.getByTestId('stats-period-apply').click()
  await page.waitForTimeout(4000)
  checks.customRange = await page.getByTestId('stats-period-range').textContent()
  checks.url = page.url()
  checks.compareLabel = await page.getByText(/vs 15 días anteriores/).first().textContent().catch(() => null)
  await shot('stats-custom.png')
  checks.summaryCalls = summaryCalls

  // ── 3. Period panel fits a 375 px phone ──
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`${baseUrl}/estadisticas?periodo=mes`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.getByTestId('stats-period-more').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(2000)
  await page.getByTestId('stats-period-more').click()
  const panel = await page.getByTestId('stats-period-panel').boundingBox()
  checks.mobilePanel = panel ? { left: Math.round(panel.x), right: Math.round(panel.x + panel.width) } : null
  await shot('stats-panel-mobile.png')

  const ok =
    checks.enabledWhileSending === true &&
    checks.typedWhileSending === 'prueba dos' &&
    JSON.stringify(checks.sendsInOrder) === JSON.stringify(['prueba uno (no se envía)', 'prueba dos']) &&
    summaryCalls.length >= 3 &&
    summaryCalls.every((c) => c.status === 200) &&
    /1–15 sep/.test(checks.customRange || '') &&
    checks.mobilePanel !== null &&
    checks.mobilePanel.left >= 0 &&
    checks.mobilePanel.right <= 375
  report(ok ? 'PASS' : 'FAIL', checks)
} catch (error) {
  if (page) await shot('composer-periods-fail.png').catch(() => {})
  report('FAIL', { ...checks, url: page?.url(), error: String(error?.message || error).slice(0, 300) })
} finally {
  await browser.close()
}
