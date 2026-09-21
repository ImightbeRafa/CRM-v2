#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {
  baseUrl,
  email,
  ensureEvidenceDir,
  evidenceDir,
  launchBrowser,
  password,
  readSession,
  report,
  signIn,
  tenantId,
} from './lib.mjs'

const probe = path.join(evidenceDir, '.doctor-write')

async function main() {
  if (!baseUrl) {
    report('TARGET_BLOCKED', { reason: 'origin-unset' })
    process.exit(3)
  }
  try {
    ensureEvidenceDir()
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
  } catch (error) {
    report('TARGET_BLOCKED', { reason: 'evidence-not-writable', message: error.message })
    process.exit(3)
  }

  let browser
  try {
    browser = await launchBrowser()
  } catch (error) {
    report('TARGET_BLOCKED', {
      reason: 'chromium-launch-failed',
      message: String(error.message || error).slice(0, 300),
    })
    process.exit(3)
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    const landed = await page.goto(`${baseUrl}/auth/signin`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    const status = landed?.status() ?? 0
    if (status >= 400) {
      report('TARGET_BLOCKED', { reason: 'signin-http', status })
      process.exit(3)
    }
    const heading = page.getByRole('heading', { name: /iniciar sesión/i })
    try {
      await heading.waitFor({ state: 'visible', timeout: 20_000 })
    } catch {
      const bodyText = await page.locator('body').innerText().catch(() => '')
      if (/vercel authentication|authentication required/i.test(bodyText)) {
        report('TARGET_BLOCKED', { reason: 'deployment-protection', status })
        process.exit(3)
      }
      report('TARGET_BLOCKED', {
        reason: 'signin-heading-missing',
        status,
        bodySnippet: bodyText.replace(/\s+/g, ' ').slice(0, 180),
      })
      process.exit(3)
    }
    if (!password) {
      report('AUTH_BLOCKED', { reason: 'password-unset', signInVisible: true })
      process.exit(2)
    }
    await signIn(page)
    const session = await readSession(page)
    if (session.email !== email || session.tenantId !== tenantId) {
      report('AUTH_BLOCKED', {
        reason: 'session-mismatch',
        gotEmail: session.email,
        gotTenant: session.tenantId,
        httpStatus: session.status,
      })
      process.exit(2)
    }
    report('READY', { signInVisible: true, sessionOk: true })
  } catch (error) {
    const message = String(error.message || error).slice(0, 300)
    report('TARGET_BLOCKED', { reason: 'doctor-exception', message })
    process.exit(3)
  } finally {
    await browser.close()
  }
}

main()
