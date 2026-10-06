#!/usr/bin/env node
/**
 * Chats › Cliente › "Vincular pedido" proof on the ISOLATED test tenant only: opens the picker,
 * attaches the first suggested order, checks it shows as "En este chat", then removes it again
 * ("Quitar del chat") so the tenant ends as it started. Never sends a message.
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, report, password } from './lib.mjs'

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const browser = await launchBrowser()
const checks = {}
let page = null
const shot = (page, name) => page.screenshot({ path: path.join(evidenceDir, name) })
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
  await page.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(8000)
  // First conversation in the list.
  await page.locator('button[data-soft-conv-key]:visible').first().click({ timeout: 20_000 })
  await page.getByTestId('chat-client-panel').waitFor({ timeout: 30_000 })
  checks.ordersBefore = await page.getByTestId('chat-flow-order').count()
  checks.linkedBefore = await page.getByText('En este chat').count()

  await page.getByTestId('chat-attach-order-toggle').click()
  await page.getByTestId('chat-attach-order-picker').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(2500)
  checks.candidates = await page.getByTestId('chat-attach-candidate').count()
  await shot(page, 'chat-attach-picker.png')
  // The search box: order number, name or phone (test tenant has an older "QA CoS Preview" order).
  await page.getByLabel('Buscar pedido para vincular').fill(process.env.ATTACH_QUERY || 'QA CoS')
  await page.waitForTimeout(3000)
  checks.searchResults = await page.getByTestId('chat-attach-candidate').count()
  await shot(page, 'chat-attach-search.png')
  if (checks.searchResults === 0) report('FAIL', { ...checks, reason: 'search found nothing' })

  const first = page.getByTestId('chat-attach-candidate').first()
  checks.attached = (await first.locator('span.truncate').first().textContent())?.trim()
  await first.getByRole('button', { name: 'Vincular' }).click()
  // Another phone than the chat's asks first.
  const confirm = page.getByRole('button', { name: 'Sí, es de esta persona' })
  if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    checks.askedPhoneConfirm = true
    await confirm.click()
  }
  await page.getByText(/vinculado al chat/).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  checks.linkedAfterAttach = await page.getByText('En este chat').count()
  await shot(page, 'chat-attach-linked.png')

  // Put the tenant back: remove the order we just attached.
  const row = page.getByTestId('chat-flow-order').filter({ hasText: checks.attached || '' }).first()
  await row.getByTestId('chat-detach-order').click()
  await page.getByRole('button', { name: 'Quitar del chat' }).last().click()
  await page.getByText(/quitado del chat/).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  checks.linkedAfterDetach = await page.getByText('En este chat').count()
  await shot(page, 'chat-attach-detached.png')

  const ok = checks.linkedAfterAttach === checks.linkedBefore + 1 && checks.linkedAfterDetach === checks.linkedBefore
  report(ok ? 'PASS' : 'FAIL', checks)
} catch (error) {
  if (page) await shot(page, "chat-attach-fail.png").catch(() => {})
  checks.url = page?.url()
  report('FAIL', { ...checks, error: String(error?.message || error).slice(0, 300) })
} finally {
  await browser.close()
}
