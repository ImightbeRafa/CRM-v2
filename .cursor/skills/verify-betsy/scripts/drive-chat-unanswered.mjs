#!/usr/bin/env node
/**
 * "Sin responder" + newest-first + "Necesita persona" proof (isolated test tenant), Lane A 2026-10-22.
 * Read-only: the test tenant has one chat, so Playwright adds three made-up waiting chats to the LIST RESPONSE
 * in the browser (route.fetch + edit; nothing is written anywhere) and marks the real test chat as
 * needsPerson. Desktop 1440×900 and phone 375×812. Never types, sends, assigns or changes a stage.
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, password, report } from './lib.mjs'

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
function fakeRows(real) {
  const mk = (n, over) => ({
    ...real,
    id: `zz-fake-${n}`,
    peerId: `fake-peer-${n}`,
    recipientId: `fake-peer-${n}`,
    recipientName: `Cliente prueba ${n}`,
    recipientUsername: null,
    recipientAvatarUrl: null,
    revision: '0',
    unreadCount: 1,
    linkedOrder: null,
    hasOpenOrder: false,
    tags: [],
    status: 'nuevo',
    stageCategory: 'open',
    aiMode: null,
    needsPerson: false,
    lastIsFollowUp: false,
    waiting: true,
    ...over,
  })
  return [
    mk(1, {
      lastMessage: '¿Tienen envío a Cartago?',
      lastMessageDirection: 'inbound',
      lastInboundAt: ago(20),
      lastMessageAt: ago(20),
      linkedOrder: { id: 'zz-fake-order', orderNumber: 'ORDER-1792438318163', status: 'Pendiente', total: 12500, items: '2x Parche de lavanda' },
    }),
    mk(2, { lastMessage: 'Hola, ¿todavía tienen la talla M?', lastMessageDirection: 'inbound', lastInboundAt: ago(130), lastMessageAt: ago(130) }),
    mk(3, { lastMessage: 'Te paso con una persona del equipo', lastMessageDirection: 'outbound', lastInboundAt: ago(300), lastMessageAt: ago(298), lastOutboundAt: ago(298), needsPerson: true, unreadCount: 0 }),
  ]
}

const browser = await launchBrowser()
const results = {}
let ok = true
try {
  for (const device of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
    { name: 'iphone-375', viewport: { width: 375, height: 812 }, mobile: true },
  ]) {
    const checks = {}
    results[device.name] = checks
    const shot = (step) => path.join(evidenceDir, `chat-unanswered-${device.name}-${step}.png`)
    const context = await browser.newContext({
      viewport: device.viewport,
      ...(device.mobile
        ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }
        : {}),
    })
    const page = await context.newPage()
    let realId = null
    // List responses: add the made-up rows (only to what this browser sees) and mark the real chat needsPerson.
    await page.route((url) => url.pathname === '/api/chat/conversations', async (route) => {
      const res = await route.fetch()
      const body = await res.json().catch(() => null)
      if (body?.success && Array.isArray(body.conversations) && body.conversations.length) {
        const real = body.conversations[0]
        realId = real.id
        const view = new URL(route.request().url()).searchParams.get('view')
        const extra = fakeRows(real)
        const marked = body.conversations.map((c) => (c.id === realId ? { ...c, needsPerson: true, waiting: true, lastMessageDirection: 'outbound' } : c))
        body.conversations = view && view !== 'sin_responder' ? marked : [...marked, ...extra]
        // "Respondido" shows as if SQL 063 were applied (its POST is answered below, never reaches the server).
        body.answeredAvailable = true
      }
      await route.fulfill({ response: res, json: body })
    })
    await page.route((url) => url.pathname === '/api/chat/conversations/view-counts', async (route) => {
      const res = await route.fetch()
      const body = await res.json().catch(() => null)
      if (body?.success && body.byAccount) {
        const first = Object.keys(body.byAccount)[0]
        if (first) body.byAccount[first] = { ...body.byAccount[first], sin_responder: 4 }
      }
      await route.fulfill({ response: res, json: body })
    })
    // Never let a write leave the browser: sends blocked, Respondido and stage changes answered here.
    await page.route((url) => /\/api\/chat\/(send|send-media)$/.test(url.pathname), (route) => route.abort())
    const answered = []
    await page.route((url) => /\/api\/chat\/conversations\/[^/]+\/answered$/.test(url.pathname), async (route) => {
      answered.push(route.request().url())
      await route.fulfill({ status: 200, contentType: 'application/json', json: { success: true, answeredAt: new Date().toISOString(), returnedToAi: false } })
    })
    await page.route((url) => /^\/api\/chat\/conversations\/[^/]+$/.test(url.pathname), async (route) => {
      if (route.request().method() === 'PATCH') await route.fulfill({ status: 200, contentType: 'application/json', json: { success: false } })
      else await route.continue()
    })

    await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.waitForTimeout(2000)
    await page.getByPlaceholder('tu@email.com').fill(email)
    await page.locator('input[type="password"]').fill(password)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 90_000 })
    await page.goto(`${baseUrl}/chats`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const rows = page.locator('[data-soft-conv-key]:visible')
    await rows.first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(2500)

    const tabs = page.locator('[data-testid="chat-view-tabs"]:visible').first()
    const tabIds = await tabs.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    checks.sinResponderRightAfterBandeja = tabIds[0] === 'chat-view-todos' && tabIds[1] === 'chat-view-sin_responder'
    checks.badgeCount = (await tabs.getByTestId('chat-view-sin_responder').textContent())?.replace(/\D+/g, '') || null
    const orderOf = async () => rows.evaluateAll((els) => els.map((e) => e.textContent || ''))
    const bandeja = await orderOf()
    const pos = (list, name) => list.findIndex((t) => t.includes(name))
    checks.bandejaNewestFirst = pos(bandeja, 'Cliente prueba 1') < pos(bandeja, 'Cliente prueba 2') && pos(bandeja, 'Cliente prueba 2') < pos(bandeja, 'Cliente prueba 3')
    checks.needsPersonChipInList = (await page.locator('[data-testid="conv-needs-person"]:visible').count()) >= 1
    await page.screenshot({ path: shot('1-bandeja') })

    await tabs.getByTestId('chat-view-sin_responder').click()
    await page.waitForTimeout(2500)
    const sin = await orderOf()
    checks.sinResponderRows = sin.length
    // A queue: OLDEST wait on top.
    checks.sinResponderOldestFirst = pos(sin, 'Cliente prueba 3') >= 0 && pos(sin, 'Cliente prueba 3') < pos(sin, 'Cliente prueba 2') && pos(sin, 'Cliente prueba 2') < pos(sin, 'Cliente prueba 1')
    checks.lineLabels = await page.locator('[data-testid="conv-line-label"]:visible').evaluateAll((els) => els.slice(0, 2).map((e) => (e.textContent || '').trim()))
    checks.lineLabelShowsChannel = checks.lineLabels.length > 0 && checks.lineLabels.every((t) => /· (WhatsApp|Instagram)$/.test(t))
    const orderChips = await page.locator('[data-testid="conv-order-chip"]:visible').evaluateAll((els) => els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()))
    checks.orderChips = orderChips
    checks.orderChipReadable =
      orderChips.some((t) => /#…18163/.test(t) && /Pendiente/.test(t) && /₡12 500/.test(t)) && orderChips.every((t) => !/ORDER-\d/.test(t))
    // No emoji in chrome (message bubbles excluded: customers and agents keep theirs).
    checks.noEmojiInChrome = await page.evaluate(() => {
      const clone = document.body.cloneNode(true)
      clone.querySelectorAll('[data-testid="soft-thread-message"], [data-testid="conv-preview"], textarea, input').forEach((n) => n.remove())
      return !/\p{Extended_Pictographic}/u.test(clone.textContent || '')
    })
    const tones = await page.locator('[data-testid="conv-wait-badge"]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')))
    checks.waitTones = tones
    checks.longWaitsMarked = tones.includes('warn') && tones.includes('late')
    checks.summary = (await page.getByTestId('unanswered-summary').first().textContent().catch(() => null))?.trim() ?? null
    checks.noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    await page.screenshot({ path: shot('2-sin-responder') })

    // Respondido on a row: it leaves Sin responder at once (the request is answered by this script).
    const rowOne = page.locator('li:visible', { has: page.locator('[data-soft-conv-key]', { hasText: 'Cliente prueba 1' }) }).first()
    if (!device.mobile) await rowOne.hover()
    const answerBtn = rowOne.getByTestId('conv-mark-answered')
    checks.rowRespondidoVisible = await answerBtn.isVisible().catch(() => false)
    if (checks.rowRespondidoVisible) {
      if (!device.mobile) await page.screenshot({ path: shot('2b-row-hover-respondido') })
      await answerBtn.click()
      await page.waitForTimeout(1200)
      checks.rowLeftSinResponder = (await rows.filter({ hasText: 'Cliente prueba 1' }).count()) === 0
      checks.respondidoCalls = answered.length
      await page.screenshot({ path: shot('2c-after-respondido') })
    }

    // The real test chat (marked needsPerson): the thread never says "IA activa".
    const realRow = rows.filter({ hasNotText: 'Cliente prueba' }).first()
    if (await realRow.count()) {
      await realRow.click()
      await page.waitForTimeout(3500)
      const chip = page.locator('[data-testid="soft-ai-truth-chip"]:visible, [data-testid="soft-agent-banner"]:visible').first()
      const text = (await chip.textContent().catch(() => '')) || ''
      checks.threadSaysNecesitaPersona = /Necesita persona/.test(text)
      checks.threadNotIaActiva = !/IA activa|está atendiendo/.test(text)
      checks.threadRespondidoButton =
        (await page.locator('[data-testid="soft-thread-mark-answered"]:visible, [data-testid="soft-thread-mark-answered-compact"]:visible').count()) > 0
      checks.threadLineLabel = device.mobile
        ? true
        : /· (WhatsApp|Instagram)/.test((await page.getByTestId('soft-thread-line').first().textContent().catch(() => '')) || '')
      await page.screenshot({ path: shot('3-thread-needs-person') })
    }
    if (!Object.values(checks).every((v) => (typeof v === 'boolean' ? v : true))) ok = false
    await context.close()
  }
  report(ok ? 'PASS' : 'FAIL', { results, mutations: 'none (made-up rows exist only in the browser; sends blocked; Respondido / stage answered in the browser)' })
} catch (error) {
  report('FAIL', { results, error: String(error?.message || error).slice(0, 400) })
} finally {
  await browser.close()
}
