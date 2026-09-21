#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {
  baseUrl,
  email,
  ensureEvidenceDir,
  evidenceDir,
  isDarkColor,
  launchBrowser,
  password,
  readSession,
  signIn,
  tenantId,
} from './lib.mjs'

const sections = ['Identidad', 'Voz', 'Herramientas', 'Modo', 'Conocimiento', 'Probar', 'Pánico']

function fail(message, extra = {}) {
  const note = {
    feature: 'agentes-contrast',
    state: 'FAIL',
    base: baseUrl,
    email,
    tenantId,
    message,
    mutations: 'none',
    ...extra,
  }
  fs.writeFileSync(path.join(evidenceDir, 'proof-agentes-contrast.md'), renderNote(note))
  process.stdout.write(`${JSON.stringify({ state: 'FAIL', message, checks: extra.checks || null })}\n`)
  process.exit(1)
}

function renderNote(note) {
  const lines = [
    '# Agentes contrast proof',
    '',
    `- Feature: \`${note.feature}\``,
    `- State: ${note.state}`,
    `- Origin: ${note.base}`,
    `- When: ${note.when || new Date().toISOString()}`,
    `- Email: ${note.email}`,
    `- Tenant: ${note.tenantId}`,
    `- Mutations: ${note.mutations}`,
    '',
  ]
  if (note.message) lines.push(`- Note: ${note.message}`, '')
  if (note.colors) {
    lines.push('## Computed colors', '')
    for (const [name, color] of Object.entries(note.colors)) {
      lines.push(
        `- ${name}: \`${color.cssColor}\` dark=${color.dark} luminance=${color.luminance}`,
      )
    }
    lines.push('')
  }
  if (note.checks) {
    lines.push('## Checks', '')
    for (const [name, value] of Object.entries(note.checks)) {
      lines.push(`- ${name}: ${value}`)
    }
    lines.push('')
  }
  if (note.files) {
    lines.push('## Files', '')
    for (const file of note.files) lines.push(`- \`${file}\``)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function colorOf(locator) {
  const cssColor = await locator.evaluate((element) => getComputedStyle(element).color)
  return isDarkColor(cssColor)
}

async function main() {
  ensureEvidenceDir()
  if (!baseUrl) {
    fail('TARGET_BLOCKED: set BETSY_VERIFY_BASE_URL or BETSY_API_URL')
  }
  if (!password) {
    fail('AUTH_BLOCKED: BETSY_V2_TEST_PASSWORD is unset')
  }

  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const colors = {}
  const checks = {}
  try {
    await signIn(page)
    const session = await readSession(page)
    checks.sessionEmail = session.email === email
    checks.sessionTenant = session.tenantId === tenantId
    checks.gotEmail = session.email
    checks.gotTenant = session.tenantId
    if (!checks.sessionEmail || !checks.sessionTenant) {
      fail('session did not match the isolated tenant', { checks, colors })
    }

    await page.goto(`${baseUrl}/config/agentes`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const empty = page.getByRole('heading', { name: 'Todavía no hay agentes' })
    const title = page.getByRole('heading', { name: 'Agentes de chat' })
    await Promise.race([
      title.waitFor({ timeout: 30_000 }),
      empty.waitFor({ timeout: 30_000 }),
    ]).catch(() => {})

    if (await empty.isVisible().catch(() => false)) {
      await page.screenshot({
        path: path.join(evidenceDir, 'agentes-sections.png'),
        fullPage: true,
      })
      fail('DATA_BLOCKED: tenant has no agents. Did not seed.', {
        checks: { ...checks, empty: true },
        files: ['agentes-sections.png'],
      })
    }

    await title.waitFor({ timeout: 10_000 })
    // The page title renders before the agent payload. Wait until Probar exists.
    try {
      await page.getByRole('heading', { name: 'Probar', exact: true }).waitFor({
        state: 'visible',
        timeout: 30_000,
      })
    } catch (error) {
      if (await empty.isVisible().catch(() => false)) {
        await page.screenshot({
          path: path.join(evidenceDir, 'agentes-sections.png'),
          fullPage: true,
        })
        fail('DATA_BLOCKED: tenant has no agents. Did not seed.', {
          checks: { ...checks, empty: true },
          files: ['agentes-sections.png'],
        })
      }
      throw error
    }
    checks.pathBefore = new URL(page.url()).pathname === '/config/agentes'
    for (const name of sections) {
      const heading = page.getByRole('heading', { name, exact: true })
      try {
        await heading.waitFor({ state: 'visible', timeout: 10_000 })
        checks[`section:${name}`] = true
      } catch {
        checks[`section:${name}`] = false
      }
    }

    const probar = page.getByRole('heading', { name: 'Probar', exact: true })
    await probar.scrollIntoViewIfNeeded()
    colors.title = await colorOf(title)
    colors.probar = await colorOf(probar)
    colors.voz = await colorOf(page.getByRole('heading', { name: 'Voz', exact: true }))
    const textarea = page.getByPlaceholder('Escribí un mensaje de prueba…')
    colors.probarTextarea = await colorOf(textarea)
    checks.contrastDark = Object.values(colors).every((color) => color.dark)

    await page.screenshot({
      path: path.join(evidenceDir, 'agentes-sections.png'),
      fullPage: true,
    })

    await page.evaluate(() => {
      window.__betsyVerifySentinel = 'agentes'
    })
    await page.getByRole('button', { name: 'Abrir wizard' }).click()
    await page.getByRole('heading', { name: 'Conocimiento del agente' }).waitFor({ timeout: 15_000 })
    const after = await page.evaluate(() => ({
      sentinel: window.__betsyVerifySentinel,
      path: window.location.pathname,
    }))
    checks.sentinelSurvived = after.sentinel === 'agentes'
    checks.pathStayed = after.path === '/config/agentes'
    checks.wizardHeading = true
    await page.screenshot({
      path: path.join(evidenceDir, 'agentes-wizard.png'),
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Volver a agentes' }).click()
    await title.waitFor({ timeout: 15_000 })
    const back = await page.evaluate(() => ({
      sentinel: window.__betsyVerifySentinel,
      path: window.location.pathname,
    }))
    checks.backSentinel = back.sentinel === 'agentes'
    checks.backPath = back.path === '/config/agentes'

    const ok =
      checks.pathBefore &&
      sections.every((name) => checks[`section:${name}`]) &&
      checks.contrastDark &&
      checks.sentinelSurvived &&
      checks.pathStayed &&
      checks.backSentinel &&
      checks.backPath

    const note = {
      feature: 'agentes-contrast',
      state: ok ? 'PASS' : 'FAIL',
      base: baseUrl,
      when: new Date().toISOString(),
      email,
      tenantId,
      mutations: 'none',
      message: ok
        ? 'Sections readable, wizard stayed on /config/agentes, document sentinel survived.'
        : 'One or more agentes contrast checks failed.',
      colors,
      checks,
      files: ['agentes-sections.png', 'agentes-wizard.png'],
    }
    fs.writeFileSync(path.join(evidenceDir, 'proof-agentes-contrast.md'), renderNote(note))
    process.stdout.write(`${JSON.stringify({ state: note.state, checks, colors })}\n`)
    if (!ok) process.exit(1)
  } catch (error) {
    const shot = path.join(evidenceDir, 'agentes-error.png')
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
    fail(String(error.message || error).slice(0, 400), {
      checks,
      colors,
      files: ['agentes-error.png'],
    })
  } finally {
    await browser.close()
  }
}

main()
