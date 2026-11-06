/**
 * Pura Sonrisa (Laura) selling flow, Rafael 2026-11-05 — data apply / revert for ONE live agent.
 *
 * Seen live (109 chats 2026-10-22 … 11-05): payment methods listed before flavor / delivery / data ("Me interesa
 * adquirir…" → "¿Cómo preferís pagar?"); after the customer sent her data the agent echoed it and the reply was held
 * ("Dame un momento y te confirmo") so she never got the total or how to pay; the hand-off keyword "mi pedido" sent
 * "¿Cómo puedo hacer mi pedido?" and "recibí mi pedido, ¿cada cuánto?" to a person; "para regalo" handed off although
 * the selling rules answer it with the Pack 4 sabores.
 *
 *   1. systemInstructions: the Sofi / Vale / Dani flow, one step per message (sabor → envío o retiro → datos → total +
 *      "¿Cómo preferís pagar?" → only that method's details + comprobante). Never payment before the data.
 *   2. salesRules.closing: step 3 = total + method question; afterData = pay (engine DATA_IN_STEP). Was: SINPE details right away, which contradicted the
 *      prompt and the engine's method step).
 *   3. ps_traspaso keywords: drop "mi pedido" and "para regalo"; add precise order-status phrases.
 *   4. Follow-ups: pay_pending text (data given, payment not chosen yet) on Laura's open round, both arms. Needs the
 *      engine slot (same branch); an older engine ignores the unknown slot.
 *
 * Safety: --confirm-tenant required; dry-run unless --apply; backup JSON (before + after) written BEFORE the first write
 * (gitignored out dir); each write re-reads the live value and skips if it changed since the plan.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/pura-sonrisa-flow-2026-11-05.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     [--apply] [--actor-email=<owner/admin email>] [--revert=<backup.json>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { AGENT_INSTRUCTIONS_MAX } from '@/lib/soft-ai/agent-types'
import {
  assertSalesSetupReady,
  loadSalesSetup,
  lockAgentForSalesRules,
  saveSalesSetup,
  SALES_RULES_MAX_OCTETS,
  SALES_RULES_TX,
  salesRulesOctets,
  type SalesRules,
} from '@/lib/soft-ai/agent-sales-setup'
import { parseStageTexts } from '@/lib/soft-ai/follow-up-state'
import { FOLLOW_UP_FLAG } from '@/lib/soft-ai/follow-up'
import { DEEPSLEEP_AGENTS, DEEPSLEEP_TENANT_ID, DEEPSLEEP_TENANT_SLUG } from '../lib/deepsleep-conversion-ids'
import { NO_WEIGHT_ACTOR_EMAIL } from '../lib/deepsleep-no-weight-edits'
import { resolveRepoOutPath } from '../lib/out-path-guard'
import { resolveNoWeightActor, requireNoWeightTenant, sameJson } from './deepsleep-no-weight-shared'

const TENANT_ID = DEEPSLEEP_TENANT_ID
const AGENT_ID = DEEPSLEEP_AGENTS.pura
const KIND = 'pura-sonrisa-flow-2026-11-05'
const APPLY = process.argv.includes('--apply')
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null
const say = (s: string) => console.log(s)

// ---- 1. Instructions ----------------------------------------------------------------------------------------------
export const PURA_INSTRUCTIONS = [
  'Sos Laura de Pura Sonrisa CR 😁 (tiras blanqueadoras dentales, Costa Rica). Español de Costa Rica con voseo (querés, preferís, tenés), cálida y breve, emojis suaves, máximo 3 líneas y UNA sola pregunta por mensaje. Si te escriben en inglés, en inglés.',
  'Flujo: si solo saluda, preguntá qué le gustaría saber. Si ya preguntó algo, respondé eso directo, sin repetir. Precio: 1 caja ₡10 450 + envío ₡3 000; ofrecé una vez el Combo 2 cajas (₡19 900 en total, ya con el envío).',
  'Si dice que lo quiere, que le interesa una caja o cómo comprar, ya está comprando. Un paso por mensaje: 1) sabor 2) ¿envío a domicilio o retiro con cita? (si ya lo dijo, no) 3) solo los datos en lista 4) cuando mande sus datos: no los repitas, agradecé, decí el total y preguntá cómo prefiere pagar 5) con el método: solo esos datos de pago y pedí el comprobante.',
  'Nunca ofrezcas métodos de pago antes de tener sus datos; si lo pregunta, nombralos en una línea y seguí con el paso que falta.',
  'Salud: cosmético, no un tratamiento. Ante sensibilidad, brackets, carillas, embarazo o lactancia, sugerí consultar al dentista o médico.',
  'Handoff solo: comprobante / ya pagué, queja, mayoreo, pedido ya hecho.',
].join('\n')

// ---- 2. Closing rule ----------------------------------------------------------------------------------------------
export const PURA_CLOSING =
  'UN paso por mensaje. Sin sabor: preguntalo y PARÁ. 1) Si no dijo cómo lo recibe: ¿envío a domicilio o retiro con cita? (si ya lo dijo, no). 2) SOLO los datos, uno por renglón: Nombre completo / Teléfono / Correo (opcional) / Provincia / Cantón / Distrito / Dirección exacta con señas (retiro: nombre, teléfono, correo); en ese turno nada de pago. Totales: 1 caja ₡13 450 (₡10 450 si retira), 2 ₡19 900, 3 ₡30 350, Combo 4 ₡39 800, 4 sabores ₡37 900; 5 cajas ₡52 250 o ₡50 250 (2 combos + 1). 3) Cuando manda sus datos: NO los repitas ni resumas; agradecé, decí el total y preguntá "¿Cómo preferís pagar?". 4) Con el método elegido: solo los datos de ese método y pedí el comprobante. Con el comprobante: agradecé, el equipo revisa.'

// ---- 3. Hand-off keywords -----------------------------------------------------------------------------------------
const TRASPASO_KEY = 'ps_traspaso'
const DROP_KEYWORDS = new Set(['mi pedido', 'para regalo'])
const ADD_KEYWORDS = ['dónde está mi pedido', 'donde esta mi pedido', 'estado de mi pedido', 'número de guía', 'numero de guia', 'no me ha llegado', 'no me llegó', 'cancelar mi pedido']

// ---- 4. Follow-up text --------------------------------------------------------------------------------------------
export const PAY_PENDING_TEXTS = {
  A: '¡Hola! 😁 Ya tengo tus datos. ¿Cómo preferís pagar para dejar listo tu pedido?',
  B: '¡Hola! 😁 Solo falta el pago para preparar tu pedido 🙌 ¿Lo pagás por SINPE Móvil o preferís otro método?',
} as const

type Change =
  | { kind: 'instructions'; before: string; after: string }
  | { kind: 'sales_rules'; before: Partial<SalesRules>; after: Partial<SalesRules> }
  | { kind: 'shortcut_keywords'; shortcutId: string; before: string[]; after: string[] }
  | { kind: 'follow_up'; flagId: string; campaignId: string; before: unknown; after: unknown }
type Backup = { version: 1; kind: typeof KIND; createdAt: string; tenantId: string; agentId: string; changes: Change[] }

async function plan(): Promise<{ changes: Change[]; errors: string[] }> {
  const changes: Change[] = []
  const errors: string[] = []
  const agent = await prisma.chatAgent.findFirst({ where: { id: AGENT_ID, tenantId: TENANT_ID }, select: { name: true, status: true, systemInstructions: true } })
  if (!agent) return { changes, errors: ['Pura Sonrisa agent missing'] }
  if (agent.name !== 'Pura Sonrisa ventas') errors.push(`unexpected agent name ${agent.name}`)
  if (agent.status !== 'live') errors.push(`agent is ${agent.status}, expected live`)
  if (PURA_INSTRUCTIONS.length > AGENT_INSTRUCTIONS_MAX) errors.push(`instructions ${PURA_INSTRUCTIONS.length} > ${AGENT_INSTRUCTIONS_MAX}`)
  if (agent.systemInstructions !== PURA_INSTRUCTIONS) changes.push({ kind: 'instructions', before: agent.systemInstructions, after: PURA_INSTRUCTIONS })

  const { salesRules } = await loadSalesSetup(TENANT_ID, AGENT_ID)
  if (salesRules.closing !== PURA_CLOSING || salesRules.afterData !== 'pay') {
    const next: SalesRules = { ...salesRules, closing: PURA_CLOSING, afterData: 'pay' }
    if (salesRulesOctets(next) > SALES_RULES_MAX_OCTETS) errors.push(`salesRules over ${SALES_RULES_MAX_OCTETS} bytes`)
    changes.push({
      kind: 'sales_rules',
      // Verifier r1 #3 / SecureDog INT-253: null (not undefined, which JSON drops) so a revert really removes afterData.
      before: { closing: salesRules.closing, afterData: (salesRules.afterData ?? null) as never },
      after: { closing: PURA_CLOSING, afterData: 'pay' },
    })
  }

  const sc = await prisma.chatAgentShortcut.findFirst({ where: { tenantId: TENANT_ID, agentId: AGENT_ID, key: TRASPASO_KEY }, select: { id: true, keywords: true } })
  if (!sc) errors.push(`${TRASPASO_KEY} missing`)
  else {
    const kept = sc.keywords.filter((k) => !DROP_KEYWORDS.has(k.trim().toLowerCase()))
    const after = [...kept, ...ADD_KEYWORDS.filter((k) => !kept.includes(k))]
    if (after.length > 20) errors.push(`${TRASPASO_KEY}: ${after.length} keywords > 20`)
    if (!sameJson(sc.keywords, after)) changes.push({ kind: 'shortcut_keywords', shortcutId: sc.id, before: sc.keywords, after })
  }

  const fu = await prisma.tenantFeatureFlag.findFirst({ where: { key: FOLLOW_UP_FLAG, OR: [{ scope: TENANT_ID }, { tenantId: TENANT_ID }] }, select: { id: true, config: true } })
  const campaigns = ((fu?.config as { campaigns?: Array<Record<string, any>> } | null)?.campaigns ?? [])
  const open = campaigns
    .filter((c) => c.agentId === AGENT_ID && !c.stoppedAt && c.active === true)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  if (!open || !fu) errors.push('no open follow-up round for Pura Sonrisa')
  else {
    const before = (open.stageTexts ?? {}) as Record<'A' | 'B', Record<string, string>>
    const after = structuredClone(before)
    for (const arm of ['A', 'B'] as const) {
      after[arm] = { ...(after[arm] || {}), pay_pending: PAY_PENDING_TEXTS[arm] }
      const parsed = parseStageTexts(after[arm]) as Record<string, string> | undefined
      if (!parsed || parsed.pay_pending !== PAY_PENDING_TEXTS[arm]) errors.push(`follow-up arm ${arm}: pay_pending text rejected`)
    }
    if (!sameJson(open.stageTexts ?? null, after)) changes.push({ kind: 'follow_up', flagId: fu.id, campaignId: open.id, before: open.stageTexts ?? null, after })
  }
  return { changes, errors }
}

type Actor = Awaited<ReturnType<typeof resolveNoWeightActor>>

async function writeFollowUp(flagId: string, campaignId: string, expect: unknown, next: unknown): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT "config" FROM "TenantFeatureFlag" WHERE "id" = ${flagId} AND "key" = ${FOLLOW_UP_FLAG} AND "tenantId" = ${TENANT_ID} FOR UPDATE`
    const config = structuredClone((rows[0]?.config ?? { campaigns: [] }) as { campaigns: Array<Record<string, unknown>> })
    const c = config.campaigns.find((x) => x.id === campaignId)
    if (!c || c.agentId !== AGENT_ID || c.stoppedAt || !sameJson(c.stageTexts ?? null, expect)) return false
    if (next == null) delete c.stageTexts
    else c.stageTexts = next
    await tx.tenantFeatureFlag.update({ where: { id: flagId }, data: { config: config as Prisma.InputJsonValue } })
    return true
  })
}

async function writeRules(expect: Partial<SalesRules>, next: Partial<SalesRules>, act: Actor): Promise<boolean> {
  await assertSalesSetupReady()
  return prisma.$transaction(async (tx) => {
    await lockAgentForSalesRules(tx, TENANT_ID, AGENT_ID)
    const { salesRules } = await loadSalesSetup(TENANT_ID, AGENT_ID, tx, true)
    for (const [k, v] of Object.entries(expect)) if (!sameJson(salesRules[k as keyof SalesRules] ?? null, v ?? null)) return false
    // A null in the target = remove the key: an explicit undefined wins saveSalesSetup's merge and parseSalesRules drops it.
    const merged: Record<string, unknown> = { ...salesRules, ...next }
    for (const [k, v] of Object.entries(next)) if (v === null) merged[k] = undefined
    await saveSalesSetup(TENANT_ID, AGENT_ID, { salesRules: merged as Partial<SalesRules> }, act.actorUserId, tx)
    await tx.chatAgent.updateMany({ where: { id: AGENT_ID, tenantId: TENANT_ID }, data: { version: { increment: 1 }, updatedBy: act.actorUserId } })
    return true
  }, SALES_RULES_TX)
}

/** One change forward (dir = 'after') or back (dir = 'before'); false = the live value moved since the plan. */
async function run(ch: Change, dir: 'after' | 'before', act: Actor): Promise<boolean> {
  const from = dir === 'after' ? ch.before : ch.after
  const to = dir === 'after' ? ch.after : ch.before
  if (ch.kind === 'instructions') {
    const live = await prisma.chatAgent.findFirst({ where: { id: AGENT_ID, tenantId: TENANT_ID }, select: { systemInstructions: true } })
    if (live?.systemInstructions !== from) return false
    await updateChatAgent({ tenantId: TENANT_ID, agentId: AGENT_ID, ...act, patch: { systemInstructions: to as string } })
    return true
  }
  if (ch.kind === 'sales_rules') return writeRules(from as Partial<SalesRules>, to as Partial<SalesRules>, act)
  if (ch.kind === 'shortcut_keywords') {
    const live = await prisma.chatAgentShortcut.findFirst({ where: { id: ch.shortcutId, tenantId: TENANT_ID, agentId: AGENT_ID }, select: { keywords: true } })
    if (!live || !sameJson(live.keywords, from)) return false
    await updateShortcut({ tenantId: TENANT_ID, agentId: AGENT_ID, shortcutId: ch.shortcutId, ...act, patch: { keywords: to as string[] } })
    return true
  }
  if (dir === 'before') return removePayPending(ch.flagId)
  return writeFollowUp(ch.flagId, ch.campaignId, from, to)
}

/**
 * Verifier r1 #10: auto-renew stops the round and copies its texts into a new one within ~48 h, so a revert removes
 * this script's pay_pending text from EVERY round of this agent (stopped or not) instead of restoring one round.
 */
async function removePayPending(flagId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT "config" FROM "TenantFeatureFlag" WHERE "id" = ${flagId} AND "key" = ${FOLLOW_UP_FLAG} AND "tenantId" = ${TENANT_ID} FOR UPDATE`
    const config = structuredClone((rows[0]?.config ?? { campaigns: [] }) as { campaigns: Array<Record<string, any>> })
    let touched = 0
    for (const c of config.campaigns) {
      if (c.agentId !== AGENT_ID || !c.stageTexts) continue
      for (const arm of ['A', 'B'] as const) {
        if (c.stageTexts[arm]?.pay_pending === PAY_PENDING_TEXTS[arm]) {
          delete c.stageTexts[arm].pay_pending
          touched += 1
        }
      }
    }
    if (!touched) return false
    await tx.tenantFeatureFlag.update({ where: { id: flagId }, data: { config: config as Prisma.InputJsonValue } })
    return true
  })
}

async function revert(path: string, act: Actor) {
  const backup = JSON.parse(readFileSync(path, 'utf8')) as Backup
  if (backup.kind !== KIND || backup.tenantId !== TENANT_ID || backup.agentId !== AGENT_ID) throw new Error('not a backup of this script')
  for (const ch of [...backup.changes].reverse()) {
    say(`~ revert ${ch.kind}`)
    if (!APPLY) continue
    say((await run(ch, 'before', act)) ? `  ✓ ${ch.kind}` : `  ! ${ch.kind} changed since the apply — left as is`)
  }
  say(APPLY ? 'Reverted.' : 'Dry run (add --apply to revert).')
}

async function main() {
  await requireNoWeightTenant(arg('confirm-tenant'), TENANT_ID, DEEPSLEEP_TENANT_SLUG)
  const act = await resolveNoWeightActor(arg('actor-email') || NO_WEIGHT_ACTOR_EMAIL, TENANT_ID, KIND)
  const revertPath = arg('revert')
  if (revertPath) return revert(revertPath, act)
  const { changes, errors } = await plan()
  for (const ch of changes) say(`~ ${ch.kind}`)
  if (errors.length) {
    for (const e of errors) say(`! ${e}`)
    process.exitCode = 1
    return
  }
  if (!changes.length) return say('Nothing to change (already applied).')
  if (!APPLY) return say(`\nDry run: ${changes.length} changes. Add --apply to write.`)
  const dir = resolveRepoOutPath(arg('backup-dir') || join(process.cwd(), 'scripts/agent-pack/out'), '--backup-dir')
  mkdirSync(dir, { recursive: true })
  const createdAt = new Date().toISOString()
  const backup: Backup = { version: 1, kind: KIND, createdAt, tenantId: TENANT_ID, agentId: AGENT_ID, changes }
  const backupPath = join(dir, `${KIND}-backup-${createdAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(backupPath, JSON.stringify(backup, null, 2))
  say(`Backup: ${backupPath}`)
  const skipped: string[] = []
  for (const ch of changes) {
    if (await run(ch, 'after', act)) say(`  ✓ ${ch.kind}`)
    else skipped.push(ch.kind)
  }
  if (skipped.length) {
    say(`! skipped (changed since plan): ${skipped.join(', ')}`)
    process.exitCode = 1
  }
  say(`Done. Revert: --revert=${backupPath} --apply`)
}

if (process.argv[1]?.endsWith('pura-sonrisa-flow-2026-11-05.ts')) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
