#!/usr/bin/env node
/**
 * Phone inbox proof (read-only, isolated test tenant), Lane A 2026-10-22: at 375×812 (iPhone-ish) and
 * 412×915 (Android) the list opens a chat, the phone's back goes thread → list (still on /chats),
 * the details sheet closes with back, and the composer stays above a (simulated) keyboard.
 * Never types into the composer, sends, assigns or changes data.
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, password, report } from './lib.mjs'

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const DEVICES = [
  {
    name: 'iphone-375',
    viewport: { width: 375, height: 812 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    name: 'android-412',
    viewport: { width: 412, height: 915 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  },
]

const browser = await launchBrowser()
const results = {}
let ok = true
try {
  for (const device of DEVICES) {
    const checks = {}
    results[device.name] = checks
    const shot = (step) => path.join(evidenceDir, `chat-mobile-${device.name}-${step}.png`)
    const context = await browser.newContext({
      viewport: device.viewport,
      userAgent: device.userAgent,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
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
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('1-list') })
    checks.listRows = await rows.count()

    // Open a chat (tap only: no typing, no send).
    await rows.first().tap()
    const thread = page.getByTestId('mobile-thread')
    await thread.waitFor({ timeout: 30_000 })
    await page.waitForTimeout(6000)
    await page.screenshot({ path: shot('2-thread') })
    const vh = device.viewport.height
    const box = async (loc) => (await loc.count()) ? await loc.first().boundingBox() : null
    const composer = await box(page.locator('[data-testid="composer-textarea"]:visible'))
    const back = await box(page.locator('button[aria-label="Volver a chats"]:visible'))
    checks.threadHeaderOnScreen = Boolean(back && back.y >= 0 && back.y < vh / 3)
    checks.composerBottom = composer ? Math.round(composer.y + composer.height) : null
    checks.composerOnScreen = Boolean(composer && composer.y + composer.height <= vh && composer.y > vh / 2)
    checks.noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

    // Keyboard: the browser shrinks the visual viewport; simulate it (300 px keyboard).
    await page.evaluate((h) => document.documentElement.style.setProperty('--chat-vv-height', `${h - 300}px`), vh)
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('3-keyboard') })
    const composerKb = await box(page.locator('[data-testid="composer-textarea"]:visible'))
    const backKb = await box(page.locator('button[aria-label="Volver a chats"]:visible'))
    checks.composerAboveKeyboard = Boolean(composerKb && composerKb.y + composerKb.height <= vh - 300 + 1)
    checks.headerVisibleWithKeyboard = Boolean(backKb && backKb.y >= 0)
    await page.evaluate((h) => document.documentElement.style.setProperty('--chat-vv-height', `${h}px`), vh)

    // Details sheet fits and closes with the phone's back.
    const details = page.getByRole('button', { name: 'Detalles del chat' })
    if (await details.count()) {
      await details.first().tap()
      const sheet = page.getByRole('dialog', { name: 'Detalles del chat' })
      await sheet.waitFor({ timeout: 15_000 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: shot('4-details') })
      const sheetBox = await sheet.boundingBox()
      checks.detailsFits = Boolean(sheetBox && sheetBox.width <= device.viewport.width + 1 && sheetBox.y + sheetBox.height <= vh + 1)
      await page.goBack()
      await page.waitForTimeout(800)
      checks.backClosesDetails = (await sheet.count()) === 0 && (await thread.count()) === 1
    }

    // Phone back: thread → list, still on /chats.
    await page.goBack()
    await page.waitForTimeout(1200)
    checks.backReturnsToList = (await thread.count()) === 0 && (await rows.count()) > 0
    checks.stillOnChats = new URL(page.url()).pathname === '/chats'
    await page.screenshot({ path: shot('5-back-to-list') })

    // In-app back button does the same (and leaves no extra history entry behind).
    await rows.first().tap()
    await thread.waitFor({ timeout: 30_000 })
    await page.locator('button[aria-label="Volver a chats"]:visible').first().tap()
    await page.waitForTimeout(1200)
    checks.inAppBackToList = (await thread.count()) === 0
    checks.historyClean = await page.evaluate(() => !(window.history.state && window.history.state.betsyChat))

    // Opened from a notification (/chats?c=<id>): back goes to the list once, never loops into the chat.
    const list = await (await page.request.get(`${baseUrl}/api/chat/conversations?limit=1`)).json().catch(() => null)
    const convId = list?.conversations?.[0]?.id
    if (convId) {
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.goto(`${baseUrl}/chats?c=${encodeURIComponent(convId)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await thread.waitFor({ timeout: 60_000 })
      await page.waitForTimeout(1500)
      checks.deepLinkUrlCleaned = !new URL(page.url()).searchParams.has('c')
      await page.goBack()
      await page.waitForTimeout(2500)
      checks.deepLinkBackToList = (await thread.count()) === 0 && new URL(page.url()).pathname === '/chats'
      await page.screenshot({ path: shot('6-deeplink-back') })
    }

    const deviceOk = Object.entries(checks).every(([k, v]) => (typeof v === 'boolean' ? v : true) || k === 'listRows')
    if (!deviceOk) ok = false
    await context.close()
  }
  report(ok ? 'PASS' : 'FAIL', { results, mutations: 'none' })
} catch (error) {
  report('FAIL', { results, error: String(error?.message || error).slice(0, 400) })
} finally {
  await browser.close()
}
