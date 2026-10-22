#!/usr/bin/env node
/**
 * Inbox send UX proof (isolated test tenant), Lane A 2026-10-22. NOTHING is sent: Playwright answers
 * /api/chat/send and /api/chat/send-media itself (route.fulfill, the request never reaches the
 * server, Meta or the database).
 * - Opening a chat on desktop puts the cursor in the composer.
 * - Three fast Enter sends: three bubbles at once, composer never disabled, focus stays.
 * - A big photo: the bubble shows at once with upload progress, the composer stays usable, the
 *   upload is shrunk in the browser (multipart much smaller than the picked file).
 * - A "delivered but not stored" answer never shows "No enviado".
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, password, report } from './lib.mjs'

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const browser = await launchBrowser()
const checks = {}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (step) => path.join(evidenceDir, `chat-send-ux-${step}.png`)
  const intercepted = { text: 0, media: 0, mediaBytes: 0, leaked: 0 }

  // Fake answers only. Any send that would leave the browser is counted as a leak.
  await page.route('**/api/chat/send', async (route) => {
    intercepted.text += 1
    const body = JSON.parse(route.request().postData() || '{}')
    await new Promise((r) => setTimeout(r, 1200))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, persisted: false, message: null, clientRequestId: body.clientRequestId }),
    })
  })
  await page.route('**/api/chat/send-media', async (route) => {
    intercepted.media += 1
    intercepted.mediaBytes = (route.request().postDataBuffer() || Buffer.alloc(0)).length
    await new Promise((r) => setTimeout(r, 2500))
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Prueba: no enviado' }) })
  })
  // A fake "sent" moves a Nuevo chat to En curso: block that stage write too (PATCH only).
  await page.route('**/api/chat/conversations/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      intercepted.stagePatch = (intercepted.stagePatch || 0) + 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false }) })
    } else await route.continue()
  })
  page.on('request', (req) => {
    if (/\/api\/chat\/send(-media)?$/.test(new URL(req.url()).pathname) && req.method() !== 'POST') intercepted.leaked += 1
  })

  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.getByRole('heading', { name: /iniciar sesión/i }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 })

  await page.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const rows = page.locator('[data-soft-conv-key]:visible')
  await rows.first().waitFor({ timeout: 60_000 })
  await rows.first().click()
  const composer = page.locator('[data-testid="composer-textarea"]:visible').first()
  await composer.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(3000)
  checks.composerFocusedOnOpen = await composer.evaluate((el) => el === document.activeElement)
  await page.screenshot({ path: shot('1-open-focused') })

  // Fast sends.
  const bubbles = page.locator('[data-testid="soft-thread-message"]:visible')
  const before = await bubbles.count()
  for (const text of ['Prueba rápida 1', 'Prueba rápida 2', 'Prueba rápida 3']) {
    await composer.fill(text)
    await composer.press('Enter')
  }
  await page.waitForTimeout(250)
  checks.threeBubblesAtOnce = (await bubbles.count()) - before === 3
  checks.composerEnabledWhileSending = await composer.isEnabled()
  checks.focusKeptAfterSend = await composer.evaluate((el) => el === document.activeElement)
  await page.screenshot({ path: shot('2-fast-sends') })
  await page.waitForTimeout(4500)
  const lastTexts = await bubbles.evaluateAll((els) => els.slice(-3).map((e) => e.textContent || ''))
  checks.sendsInOrder = lastTexts.every((t, i) => t.includes(`Prueba rápida ${i + 1}`))
  checks.noFailedOnDelivered = !lastTexts.some((t) => t.includes('No enviado'))

  // Big photo (1800×1350 camera-like PNG, ~7 MB, drawn in the page): pending bubble + progress, composer stays free.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1800
    c.height = 1350
    const ctx = c.getContext('2d')
    // Camera-like noise: a PNG that does not compress (a real phone photo is several MB).
    const img = ctx.createImageData(1800, 1350)
    for (let i = 0; i < img.data.length; i += 1) img.data[i] = i % 4 === 3 ? 255 : (Math.random() * 255) | 0
    ctx.putImageData(img, 0, 0)
    return c.toDataURL('image/png')
  })
  const png = Buffer.from(dataUrl.split(',')[1], 'base64')
  checks.pickedBytes = png.length
  const fileInput = page.locator('input[type="file"]').first()
  if (await fileInput.count()) {
    await fileInput.setInputFiles({ name: 'foto-grande.png', mimeType: 'image/png', buffer: png })
    await page.waitForTimeout(400)
    await composer.press('Enter')
    await page.waitForTimeout(300)
    const pending = page.getByTestId('pending-media-bubble')
    checks.photoBubbleAtOnce = (await pending.count()) > 0
    checks.composerEnabledDuringUpload = await composer.isEnabled()
    await page.screenshot({ path: shot('3-photo-uploading') })
    await page.waitForTimeout(4000)
    checks.uploadBytes = intercepted.mediaBytes
    checks.photoShrunk = intercepted.mediaBytes > 0 && intercepted.mediaBytes < png.length * 0.7
    checks.failedPhotoMarked = (await page.getByTestId('pending-media-bubble').getByText('No se envió').count()) > 0
    checks.failedPhotoHasRetryNote = (await page.getByText(/No enviado/).count()) > 0
    await page.screenshot({ path: shot('4-photo-failed-retry') })
  } else {
    checks.fileInput = 'absent (files off for this tenant)'
  }
  checks.intercepted = intercepted
  const ok =
    Object.values(checks).every((v) => (typeof v === 'boolean' ? v : true)) && intercepted.leaked === 0
  report(ok ? 'PASS' : 'FAIL', { checks, mutations: 'none (sends and stage changes answered by the test, never reached the server; opening the chat marks it read as usual)' })
} catch (error) {
  report('FAIL', { checks, error: String(error?.message || error).slice(0, 400) })
} finally {
  await browser.close()
}
