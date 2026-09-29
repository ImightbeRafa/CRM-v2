#!/usr/bin/env node
/**
 * Phase 2b UI proof (read-only, isolated test tenant): snooze button + Pospuestos bucket, tasks
 * panel in the Cliente tab, presence API answering, Mis tareas page, bell notifications API,
 * Config › Chats rules card (all rules off), business memberships API. Never clicks save / send /
 * snooze / create; the only writes are presence heartbeats (in-memory, 20 s TTL).
 */
import path from 'node:path'
import { baseUrl, email, ensureEvidenceDir, evidenceDir, launchBrowser, password, readSession, report, tenantId } from './lib.mjs'

async function signIn(page) {
  await page.goto(`${baseUrl}/auth/signin`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.getByRole('heading', { name: /iniciar sesión/i }).waitFor({ timeout: 25_000 })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder('tu@email.com').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
}

if (!baseUrl) report('TARGET_BLOCKED', { reason: 'BETSY_VERIFY_BASE_URL unset' })
if (!password) report('AUTH_BLOCKED', { reason: 'BETSY_V2_TEST_PASSWORD unset' })
ensureEvidenceDir()

const browser = await launchBrowser()
const checks = {}
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
  const page = await context.newPage()
  await signIn(page)
  const session = await readSession(page)
  checks.isolatedTenant = session?.tenantId === tenantId
  if (!checks.isolatedTenant) report('AUTH_BLOCKED', { reason: 'wrong tenant', checks })

  // APIs (GET only).
  const api = async (p) => page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'same-origin' })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, p)
  const list = await api('/api/chat/conversations?limit=5')
  checks.snoozeAvailable = list.json?.snoozeAvailable === true
  const snoozed = await api('/api/chat/conversations?snoozed=1&limit=5')
  checks.snoozedListOk = snoozed.status === 200 && Array.isArray(snoozed.json?.conversations)
  const notif = await api('/api/workspace/notifications')
  checks.notificationsApi = notif.status === 200 && notif.json?.available === true && typeof notif.json?.overdueTasks === 'number'
  const mine = await api('/api/crm/tasks?mine=1')
  checks.myTasksApi = mine.status === 200 && mine.json?.available === true
  const rules = await api('/api/config/chat-workspace')
  checks.rulesApi = rules.status === 200 && rules.json?.available === true
  checks.rulesAllOff = rules.json?.settings?.assignmentMode === 'off' && rules.json?.settings?.autoCloseDays === null
  const firstId = list.json?.conversations?.[0]?.id
  if (firstId) {
    const pres = await api(`/api/chat/conversations/${firstId}/presence`)
    checks.presenceApi = pres.status === 200 && Array.isArray(pres.json?.people)
    const tasks = await api(`/api/crm/tasks?conversationId=${firstId}`)
    checks.chatTasksApi = tasks.status === 200 && tasks.json?.available === true
  }

  // Inbox UI.
  await page.goto(`${baseUrl}/chats`, { waitUntil: 'networkidle', timeout: 120_000 })
  const row = page.locator('button[data-soft-conv-key]:visible').first()
  await row.waitFor({ timeout: 90_000 })
  await row.click()
  await page.locator('[data-testid="chat-context-rail"]').first().waitFor({ timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(4000)
  checks.snoozeButton = (await page.locator('[data-testid="chat-snooze-button"]').count()) > 0
  checks.tasksPanel = (await page.locator('[data-testid="chat-tasks-panel"]').count()) > 0
  checks.notesPanel = (await page.locator('[data-testid="chat-notes-panel"]').count()) > 0
  checks.noteScopeToggle = (await page.locator('[data-testid="note-scope-toggle"]').count()) > 0
  await page.screenshot({ path: path.join(evidenceDir, 'phase2b-chat-rail.png') })
  // Bucket menu lists Pospuestos (open the menu, read, close with Escape).
  const viewMenu = page.getByRole('button', { name: /Abiertos|Tus chats|Sin asignar|Hechos/ }).first()
  if (await viewMenu.count()) {
    await viewMenu.click().catch(() => undefined)
    await page.waitForTimeout(500)
    checks.pospuestosBucket = (await page.getByText('Pospuestos', { exact: true }).count()) > 0
    await page.keyboard.press('Escape')
  }

  // Bell opens (read-only).
  const bell = page.getByRole('button', { name: /^Avisos/ }).first()
  if (await bell.count()) {
    await bell.click()
    await page.waitForTimeout(800)
    checks.bellOpens = (await page.getByRole('dialog', { name: 'Avisos' }).count()) > 0
    await page.screenshot({ path: path.join(evidenceDir, 'phase2b-bell.png') })
    await page.keyboard.press('Escape')
  }

  // Mis tareas page.
  await page.goto(`${baseUrl}/tareas`, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.waitForTimeout(2500)
  checks.myTasksPage = (await page.getByRole('heading', { name: 'Mis tareas' }).count()) > 0
  checks.myTasksContent = (await page.locator('[data-testid="my-tasks-empty"], [data-testid="my-tasks-list"]').count()) > 0
  checks.tareasInNav = (await page.getByRole('link', { name: 'Tareas' }).count()) > 0
  await page.screenshot({ path: path.join(evidenceDir, 'phase2b-tareas.png') })

  // Config › Chats rules card.
  await page.goto(`${baseUrl}/config?tab=chats`, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.locator('[data-testid="chats-config-rules"]').first().waitFor({ timeout: 60_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
  checks.rulesCard = (await page.locator('[data-testid="chats-config-rules"]').count()) > 0
  checks.rulesCardReady = (await page.getByRole('radiogroup', { name: 'Modo de asignación' }).count()) > 0
  await page.locator('[data-testid="chats-config-rules"]').first().screenshot({ path: path.join(evidenceDir, 'phase2b-config-rules.png') }).catch(() => undefined)

  process.stdout.write(`${JSON.stringify({ state: 'DONE', checks })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ state: 'FAIL', message: String(error?.message || error).slice(0, 300), checks })}\n`)
  process.exitCode = 1
} finally {
  await browser.close()
}
