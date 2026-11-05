// Pedidos "Pagos por confirmar" + Estadísticas tabs + sidebar logo: read-only screenshots.
// Usage: node --env-file=.env.local .cursor/skills/verify-betsy/scripts/drive-paystats.mjs [tag] [paths...]
import path from 'node:path'
import { baseUrl, email, password, evidenceDir, ensureEvidenceDir, launchBrowser, report } from './lib.mjs'

// Like lib signIn, but waits for hydration (a cold dev server submits the bare form otherwise).
async function signIn(page) {
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.waitForTimeout(3000)
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 })
}

const tag = process.argv[2] || 'run'
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ['/ventas', '/estadisticas/anuncios', '/estadisticas/equipo', '/estadisticas/clientes']
const out = path.join(evidenceDir, 'paystats')
ensureEvidenceDir()
const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
try {
  await signIn(page)
  const shots = []
  for (const p of paths) {
    await page.goto(`${baseUrl}${p}`, { waitUntil: 'networkidle', timeout: 90_000 })
    await page.waitForTimeout(1500)
    const file = path.join(out, `${tag}-${p.replace(/[^a-z0-9]+/gi, '_')}.png`)
    await page.screenshot({ path: file, fullPage: true })
    shots.push(file)
  }
  const logo = page.locator('aside a[aria-label="Betsy — Inicio"]').first()
  if (await logo.count()) {
    const file = path.join(out, `${tag}-logo.png`)
    await logo.screenshot({ path: file })
    shots.push(file)
  }
  report('OK', { shots, errors, mutations: 'none' })
} catch (e) {
  report('FAIL', { error: String(e), errors })
  process.exitCode = 1
} finally {
  await browser.close()
}
