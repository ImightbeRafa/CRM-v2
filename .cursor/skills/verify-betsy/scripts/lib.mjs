import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

export const skillRoot = path.resolve(scriptDir, '..')
export const evidenceDir = path.join(skillRoot, 'evidence')

export const baseUrl = (process.env.BETSY_VERIFY_BASE_URL || process.env.BETSY_API_URL || '').replace(
  /\/$/,
  '',
)
export const email = process.env.BETSY_V2_TEST_EMAIL || 'betsyv2.isolated@betsycrm.test'
export const password = process.env.BETSY_V2_TEST_PASSWORD || ''
export const tenantId = process.env.BETSY_V2_TEST_TENANT_ID || 'cmteijij70000jsoyedmtfnl1'

export function ensureEvidenceDir() {
  fs.mkdirSync(evidenceDir, { recursive: true })
}

export function report(state, detail = {}) {
  const line = {
    state,
    base: baseUrl,
    email,
    tenantId,
    ...detail,
  }
  process.stdout.write(`${JSON.stringify(line)}\n`)
}

export async function launchBrowser() {
  return chromium.launch({ headless: true })
}

export async function signIn(page) {
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  const heading = page.getByRole('heading', { name: /iniciar sesión/i })
  await heading.waitFor({ timeout: 25_000 })
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 25_000 })
}

export async function readSession(page) {
  const response = await page.request.get(`${baseUrl}/api/auth/session`)
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return {
    status: response.status(),
    email: body?.user?.email ?? null,
    tenantId: body?.user?.tenantId ?? null,
  }
}

export function isDarkColor(cssColor) {
  const match = String(cssColor).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!match) return { dark: false, reason: 'unparsed', cssColor }
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  const channel = (value) => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  const dark = luminance < 0.2 && r <= 90 && g <= 90 && b <= 90
  return { dark, r, g, b, luminance: Number(luminance.toFixed(4)), cssColor }
}
