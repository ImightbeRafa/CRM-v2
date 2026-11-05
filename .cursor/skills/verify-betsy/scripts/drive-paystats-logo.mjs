// Sidebar Betsy mark: state + crisp crops at 1x and 4x, sampled over a few seconds. Read-only.
import path from 'node:path'
import { baseUrl, email, password, evidenceDir, ensureEvidenceDir, launchBrowser, report } from './lib.mjs'

const tag = process.argv[2] || 'logo'
const out = path.join(evidenceDir, 'paystats')
ensureEvidenceDir()
const browser = await launchBrowser()
const result = {}
try {
  for (const dsf of [1, 4]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dsf, colorScheme: 'dark' })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 90_000 })
    await page.waitForTimeout(3000)
    await page.getByPlaceholder('tu@email.com').fill(email)
    await page.locator('input[type="password"]').fill(password)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 90_000 })
    await page.waitForTimeout(2500)
    const logo = page.locator('aside a[aria-label="Betsy — Inicio"]').first()
    const states = []
    for (let i = 0; i < 3; i++) {
      states.push(
        await logo.evaluate((el) => {
          const bm = el.querySelector('[data-state]')
          const svg = bm?.querySelector('svg')
          const cs = svg ? getComputedStyle(svg) : null
          return { state: bm?.getAttribute('data-state'), on: bm?.hasAttribute('data-on'), small: bm?.hasAttribute('data-small'), filter: cs?.filter, opacity: cs?.opacity }
        }),
      )
      await logo.screenshot({ path: path.join(out, `${tag}-dsf${dsf}-${i}.png`) })
      await page.waitForTimeout(1200)
    }
    result[`dsf${dsf}`] = states
    await context.close()
  }
  report('OK', { result, mutations: 'none' })
} catch (e) {
  report('FAIL', { error: String(e), result })
  process.exitCode = 1
} finally {
  await browser.close()
}
