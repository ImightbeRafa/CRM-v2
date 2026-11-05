// Estadísticas tabs with realistic intercepted API data (nothing reaches the server). Read-only.
// Usage: node --env-file=.env.local .cursor/skills/verify-betsy/scripts/drive-paystats-fixtures.mjs [tag] [width]
import path from 'node:path'
import { baseUrl, email, password, evidenceDir, ensureEvidenceDir, launchBrowser, report } from './lib.mjs'

const tag = process.argv[2] || 'fx'
const width = Number(process.argv[3] || 1440)
const out = path.join(evidenceDir, 'paystats')
ensureEvidenceDir()

const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']
const range = { startDate: days[0], endDate: days[6] }
const H = 3_600_000
const M = 60_000
const equipo = {
  range,
  team: [
    { userId: 'u1', name: 'Deep Sleep' },
    { userId: 'u2', name: 'María Fernanda' },
    { userId: 'u3', name: 'Carlos' },
  ],
  report: {
    overall: { firstResponseMedianMs: 14 * M, firstResponseP90Ms: 3.2 * H, samples: 186, waiting: 7, waitingUnassigned: 3, open: 142 },
    daily: days.map((date, i) => ({ date, medianMs: [22, 9, 31, 48, 12, 15, 8][i] * M, samples: 20 + i })),
    channels: [
      { channel: 'whatsapp', firstResponseMedianMs: 11 * M, firstResponseP90Ms: 2.1 * H, firstResponseSamples: 131, open: 96, waiting: 5, oldestWaitingMs: 26 * H, chatsStarted: 212, linkedOrders: 38, chatToSale: 38 / 212 },
      { channel: 'instagram', firstResponseMedianMs: 27 * M, firstResponseP90Ms: 5.4 * H, firstResponseSamples: 55, open: 46, waiting: 2, oldestWaitingMs: 3 * H, chatsStarted: 133, linkedOrders: 11, chatToSale: 11 / 133 },
    ],
    teammates: [
      { userId: 'u1', firstResponseMedianMs: 9 * M, firstResponseP90Ms: 1.5 * H, firstResponseSamples: 104, openAssigned: 61, waitingAssigned: 4, replies: 812 },
      { userId: 'u2', firstResponseMedianMs: 18 * M, firstResponseP90Ms: 4 * H, firstResponseSamples: 63, openAssigned: 38, waitingAssigned: 0, replies: 455 },
      { userId: 'u3', firstResponseMedianMs: 41 * M, firstResponseP90Ms: 7 * H, firstResponseSamples: 19, openAssigned: 12, waitingAssigned: 0, replies: 96 },
    ],
  },
}
const adRow = (key, headline, campaignName, platforms, chats, orders, paid, booked) => ({
  key, adId: key.replace('ad:', ''), headline, sourceUrl: 'https://fb.me/ad', campaignName, platforms, chats, orders,
  paidOrders: paid, booked, collected: Math.round((booked * paid) / Math.max(orders, 1)), conversion: chats ? orders / chats : null,
})
const anuncios = {
  range,
  period: 'ultimos-7',
  platform: null,
  revenueMode: 'booked',
  report: {
    rows: [
      adRow('ad:120211', 'ARNESS FORGE: dormí sin roncar desde la primera noche', 'Forge · Conversiones Oct', ['whatsapp', 'instagram'], 148, 19, 15, 283100),
      adRow('ad:120212', 'Bucal anti-ronquidos 2x1 solo esta semana', 'Bucal · Promo 2x1', ['whatsapp'], 96, 9, 7, 116100),
      adRow('ad:120213', 'Video testimonio Andrés', null, ['instagram'], 41, 2, 1, 29800),
    ],
    hiddenAds: 2,
    daily: days.map((date, i) => ({ date, adOrders: [3, 5, 8, 1, 2, 7, 4][i], organicOrders: [2, 1, 3, 0, 2, 4, 1][i], adBooked: 0, organicBooked: 0 })),
    organic: { key: 'organic', adId: null, headline: null, sourceUrl: null, campaignName: null, platforms: [], chats: 60, orders: 13, paidOrders: 11, booked: 181700, collected: 155000, conversion: 13 / 60 },
    withoutChat: { orders: 6, paidOrders: 6, booked: 88400, collected: 88400 },
    cancelled: { orders: 2, paidOrders: 0, booked: 29800, collected: 0 },
    windowDays: 7,
    totals: { adChatsDistinct: 270, organicChats: 60, orders: 51, adOrders: 30, booked: 699100, collected: 560000 },
  },
}
const dueRow = (i, name, label, daysLeft) => ({
  key: `k${i}`, customerName: name, phone: `8888-12${10 + i}`, ruleLabel: label, lastOrderNumber: `#${2200 + i}`, lastOrderDate: '2026-10-05',
  units: 30, runsOutOn: `2026-11-0${Math.max(1, Math.min(9, 4 + daysLeft))}`, daysLeft,
  suggestedMessage: `Hola ${name.split(' ')[0]}, cómo te ha ido con el ${label}?`, chatHref: '/chats', whatsappHref: 'https://wa.me/50688881210',
})
const recompra = {
  windowDays: 7, overdueDays: 14, todayKey: '2026-11-04', lookbackDays: 45,
  rules: [{ id: 'r1', label: 'Parches 30', match: 'parche', days: 30 }],
  rows: [dueRow(1, 'Andrés M Sol', 'Parches 30', -3), dueRow(2, 'Francisco Gutiérrez', 'Bucal', 0), dueRow(3, 'Christian Jiménez', 'Parches 30', 2), dueRow(4, 'Laura Vargas Rojas', 'Parches 30', 5)],
}
const repRow = (i, name, orders, spent, since) => ({
  clientId: `c${i}`, name, phone: `8701-55${10 + i}`, totalOrders: orders, totalSpent: spent, lastOrder: `2026-10-2${i % 9}`,
  daysSinceLast: since, chatHref: '/chats', whatsappHref: 'https://wa.me/50687015510',
})
const recurrentes = {
  sort: 'recientes', total: 214, page: 1, pageSize: 50,
  rows: [repRow(1, 'Christian Jiménez', 4, 59600, 0), repRow(2, 'Andrés M Sol', 3, 44700, 1), repRow(3, 'Francisco Gutiérrez', 2, 25800, 2), repRow(4, 'Laura Vargas Rojas', 6, 101400, 5), repRow(5, 'José Pablo Mora', 2, 29800, 12), repRow(6, 'Valeria Solís', 3, 41700, 33)],
}

async function signIn(page) {
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForTimeout(3000)
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 })
}

const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width, height: Number(process.argv[4] || 2400) }, deviceScaleFactor: width < 600 ? 2 : 1, colorScheme: 'dark' })
const page = await context.newPage()
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
await page.route('**/api/estadisticas/equipo**', (r) => r.fulfill(json(equipo)))
await page.route(/\/api\/estadisticas\/anuncios\?/, (r) => r.fulfill(json(anuncios)))
await page.route('**/api/estadisticas/clientes/recompra**', (r) => r.fulfill(json(recompra)))
await page.route('**/api/estadisticas/clientes/recurrentes**', (r) => r.fulfill(json(recurrentes)))

// Pedidos › Pagos por confirmar: 4 contra entrega (like DeepSleep's Inicio card) + 1 SINPE waiting.
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString()
const pendingOrder = (no, name, phone, product, total, daysAgo, cod, status = 'Pendiente') => ({
  id: `fx${no}`, orderId: `FX-${no}`, orderNo: no, orderType: 'EA', status, timestamp: ago(daysAgo), updatedAt: ago(daysAgo),
  customerName: name, phone, product, quantity: 1, total, courier: 'Correos de Costa Rica', comments: cod ? '' : 'Pago SINPE',
  customFields: cod ? {} : { paymentMethod: 'SINPE', paymentStatus: 'pending' }, contraEntrega: cod, cePaymentConfirmed: false,
  itemLines: [`1× ${product}`], tenantId: 'fx',
})
let pending = [
  pendingOrder(2291, 'Francisco Gutiérrez', '8834-2210', 'Bucal', 12900, 9, true, 'Enviado'),
  pendingOrder(2296, 'Andrés M Sol', '7012-4431', 'ARNESS FORGE 3XL', 14900, 6, true, 'Enviado'),
  pendingOrder(2301, 'Laura Vargas Rojas', '8701-5514', 'ARNESS FORGE M', 14900, 3, true),
  pendingOrder(2305, 'José Pablo Mora', '6044-1180', 'Parches x30', 14900, 1, true),
  pendingOrder(2308, 'Valeria Solís', '8890-7733', 'Bucal', 12900, 0, false),
]
await page.route('**/api/orders?pago=por_confirmar**', (r) => r.fulfill(json({ status: 'success', data: pending })))
await page.route('**/api/orders/confirm-payment', async (r) => {
  const body = r.request().postDataJSON()
  pending = pending.filter((o) => o.orderId !== body.orderId)
  await r.fulfill(json({ success: true }))
})
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
try {
  await signIn(page)
  const shots = []
  let file
  for (const p of ['/estadisticas/anuncios', '/estadisticas/equipo', '/estadisticas/clientes']) {
    await page.goto(`${baseUrl}${p}`, { waitUntil: 'networkidle', timeout: 90_000 })
    await page.waitForTimeout(1500)
    const file = path.join(out, `${tag}-${width}-${p.replace(/[^a-z0-9]+/gi, '_')}.png`)
    await page.screenshot({ path: file, fullPage: true })
    shots.push(file)
  }
  const logo = page.locator('aside a[aria-label="Betsy — Inicio"]').first()
  file = path.join(out, `${tag}-${width}-logo.png`)
  if (await logo.isVisible()) await logo.screenshot({ path: file })
  shots.push(file)
  // Inicio "Revisar" deep link opens the section; then confirm the oldest one.
  await page.goto(`${baseUrl}/ventas?vista=pagos`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForTimeout(1500)
  const section = page.getByTestId('pagos-por-confirmar')
  const before = await section.locator('tbody tr').count()
  file = path.join(out, `${tag}-${width}-ventas-pagos.png`)
  await page.screenshot({ path: file, fullPage: true })
  shots.push(file)
  await section.getByRole('button', { name: 'Confirmar pago' }).first().click()
  await section.getByRole('button', { name: 'Sí, recibido' }).waitFor()
  file = path.join(out, `${tag}-${width}-ventas-pagos-ask.png`)
  await section.screenshot({ path: file })
  shots.push(file)
  await section.getByRole('button', { name: 'Sí, recibido' }).click()
  await page.waitForTimeout(1500)
  const after = await section.locator('tbody tr').count()
  file = path.join(out, `${tag}-${width}-ventas-pagos-done.png`)
  await page.screenshot({ path: file, fullPage: true })
  shots.push(file)
  report('OK', { shots, errors, pagos: { before, after }, mutations: 'none (API responses intercepted)' })
} catch (e) {
  report('FAIL', { error: String(e), errors })
  process.exitCode = 1
} finally {
  await browser.close()
}
