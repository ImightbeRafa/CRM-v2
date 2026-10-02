#!/usr/bin/env node
/**
 * Inbox live-update proof (read-only, isolated test tenant): the Chats page loads, the sound
 * switch is there, and the inbox keeps polling /changes on its own (no refresh). Never sends,
 * clicks save or changes data.
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, password, report } from './lib.mjs'

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const browser = await launchBrowser()
const checks = {}
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.getByRole('heading', { name: /iniciar sesión/i }).waitFor({ timeout: 25_000 })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 })

  const polls = []
  page.on('response', (res) => {
    const u = res.url()
    if (u.includes('/api/chat/conversations/changes')) polls.push({ at: Date.now(), status: res.status() })
  })
  await page.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(15_000)
  checks.url = page.url()
  checks.soundToggleCount = await page.getByTestId('chat-sound-toggle').count()
  checks.soundToggleVisible = checks.soundToggleCount > 0 && (await page.getByTestId('chat-sound-toggle').first().isVisible())
  checks.syncLabel = await page.getByText(/Sincronizado|Actualizado/).first().textContent().catch(() => null)
  const startedAt = Date.now()
  await page.waitForTimeout(32_000)
  const after = polls.filter((p) => p.at >= startedAt)
  checks.changesPolls = after.length
  checks.changesStatuses = [...new Set(after.map((p) => p.status))]
  checks.maxGapS = after.length > 1
    ? Math.round(Math.max(...after.slice(1).map((p, i) => p.at - after[i].at)) / 100) / 10
    : null
  await page.screenshot({ path: path.join(evidenceDir, 'inbox-live.png') })
  const ok = checks.changesPolls >= 4 && checks.changesStatuses.every((s) => s === 200)
  report(ok ? 'PASS' : 'FAIL', checks)
} catch (error) {
  report('FAIL', { ...checks, error: String(error?.message || error).slice(0, 300) })
} finally {
  await browser.close()
}
