/**
 * DeepSleep bot fixes (Rafael 2026-11-04) — data apply / revert for the 5 live store agents (PatchHouse included).
 *
 *   1. Same pickup / hours / contra-entrega wording on every agent (the one already used most: "con cita previa, todos
 *      los días 9:00 am a 6:00 pm"); card = a person sends the payment link (no website link).
 *   2. Forge: free shipping promo through November (promo.endsAt 2026-11-30, headline), size exchange in returns,
 *      4 arneses = 2 × Pack de 2 (website prices only).
 *   3. Every agent: "end each reply with one concrete next step, never repeat a question" (selling rules, mustSay).
 *   4. Pura: the payment-method reply ends with "¿Cómo preferís pagar?" like the others.
 *   5. One shared knowledge doc "Zona GAM (contra entrega)" bound to the 5 agents (from src/lib/correos-gam-pricing.ts).
 *   6. Tenant flag agent_card_by_team_v1 on.
 *   7. Follow-ups: state-aware texts (where the chat stopped) on each agent's newest open round — arm B the base set,
 *      arm A the same steps, shorter. Auto-renew copies them. Never touches a stopped round.
 *
 * Safety: --confirm-tenant required; dry-run unless --apply; a backup JSON (before + after) is written BEFORE the first
 * write (gitignored out dir); each write re-reads the live value and skips if it changed since the plan.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-bot-fixes-2026-11-04.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     [--apply] [--actor-email=<owner/admin email>] [--revert=<backup.json>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { approveKnowledgeSource, bindKnowledgeToAgent, createKnowledgeSource, unbindKnowledgeFromAgent } from '@/lib/soft-ai/knowledge-admin'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
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
import { CARD_BY_TEAM_FLAG } from '@/lib/soft-ai/payment-guard'
import { DEEPSLEEP_AGENTS, DEEPSLEEP_TENANT_ID, DEEPSLEEP_TENANT_SLUG } from '../lib/deepsleep-conversion-ids'
import { NO_WEIGHT_ACTOR_EMAIL } from '../lib/deepsleep-no-weight-edits'
import { resolveRepoOutPath } from '../lib/out-path-guard'
import { resolveNoWeightActor, requireNoWeightTenant, sameJson } from './deepsleep-no-weight-shared'

const TENANT_ID = DEEPSLEEP_TENANT_ID
const APPLY = process.argv.includes('--apply')
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null
const say = (s: string) => console.log(s)

// ---- 1. Shared wording -------------------------------------------------------------------------------------------
const PICKUP_INSTRUCTIONS =
  'Retiro solo con cita previa, todos los días de 9:00 am a 6:00 pm. Al llegar, tocar el pito y dar el número de pedido (sin ese número no se entrega). Se puede enviar un Uber o Uber Flash a retirar con la cita.'
const PICKUP_RA_TEXT = 'Retiro con cita en San Juan de Dios de Desamparados o San Rafael (se coordina), todos los días 9:00 am a 6:00 pm.'
const COD_TEXT =
  'En todo el GAM con mensajería privada; se paga al mensajero por SINPE o efectivo exacto (no llevan cambio). Fuera del GAM: SINPE, transferencia o tarjeta.'
const PAY_INSTRUCTIONS =
  'En el detalle del SINPE poner el nombre de quien compra y mandar el comprobante por este chat. Tarjeta: una persona del equipo manda el link de pago con el monto exacto (nunca datos de tarjeta por el chat). Si se paga hoy antes de las 5 pm, se envía lo antes posible.'
const FORGE_RETURNS =
  'Defecto de fábrica: se reembolsa o se cambia por uno nuevo (foto o video por WhatsApp). Cambio de talla: si no te queda, se cambia por otra talla; lo coordina una persona del equipo con tu número de pedido.'
const NEXT_STEP_RULE =
  'Terminá cada respuesta con UNA pregunta concreta del siguiente paso (talla, cantidad, envío, datos o pago); nunca repitas una pregunta que ya hiciste ni mandes el mismo mensaje dos veces'

// ---- 5. GAM doc (from correos-gam-pricing.ts lists) -------------------------------------------------------------
const GAM_DOC_NAME = 'Zona GAM (contra entrega)'
const GAM_DOC_BODY = [
  'Contra entrega con mensajería privada: SOLO dentro del GAM. Fuera del GAM se paga por SINPE, transferencia o tarjeta (el link lo manda una persona).',
  '',
  'ES GAM: todos los cantones de San José, Heredia, Alajuela y Cartago, salvo los de la lista de abajo. Ejemplos de GAM: San José centro, Escazú, Desamparados, Aserrí, Moravia, Tibás, Goicoechea, Montes de Oca, Curridabat, Santa Ana, Alajuelita, Coronado, Heredia centro, Ulloa, San Francisco, Mercedes, Barva, Santo Domingo, Santa Bárbara, San Rafael, San Isidro, Belén, Flores (San Joaquín, San Lorenzo), San Pablo, Alajuela centro, San Ramón centro, Grecia centro, Naranjo centro, Palmares centro, Poás centro, Cartago centro, La Unión (Tres Ríos), Paraíso, Oreamuno, El Guarco, Alvarado.',
  '',
  'NO es GAM (provincias completas): Guanacaste, Puntarenas, Limón.',
  'NO es GAM (cantones completos): Pérez Zeledón (San José); San Mateo, Zarcero, Atenas, Orotina, San Carlos, Upala, Los Chiles, Guatuso, Río Cuarto (Alajuela); Sarapiquí (Heredia).',
  'NO es GAM (distritos alejados): Desamparados: Frailes, San Cristóbal, Rosario. Puriscal: todos menos Santiago centro. Tarrazú: San Lorenzo, San Carlos. Aserrí: Tarbaca, Vuelta de Jorco, San Gabriel, Legua, Monterrey. Mora: Guayabo, Tabarcia, Piedras Negras, Picagres, Jaris, Quitirrisí. Coronado: Dulce Nombre de Jesús, Cascajal. Acosta: Guaitil, Palmichal, Cangrejal, Sabanillas. Turrubares, Dota y León Cortés: fuera. Alajuela: Sarapiquí. San Ramón: todos menos el centro. Grecia: San Isidro, San José, San Roque, Tacares, Puente de Piedra, Bolívar. Palmares: Zaragoza, Buenos Aires, Santiago, Candelaria, Esquipulas, La Granja. Poás: San Juan, San Rafael, Carrillos, Sabana Redonda. Sarchí: Sarchí Sur, Toro Amarillo, San Pedro, Rodríguez. Naranjo: San Miguel, San José, Cirrí Sur, San Jerónimo, San Juan, Rosario, Palmitos. Paraíso: Orosi. Jiménez: Tucurrique, Pejibaye. Turrialba: La Suiza, Peralta, Santa Cruz, Santa Teresita, Pavones, Tuis, Tayutic, Santa Rosa, Tres Equis, La Isabel, Chirripó. El Guarco: Patio de Agua. Heredia: Vara Blanca.',
  '',
  'Cómo responder: si el cliente da un cantón del GAM, confirmá la contra entrega con seguridad (no digas "no puedo confirmar"). Si el cantón tiene distritos alejados y no dijo el distrito, preguntá el distrito. Solo si de verdad no se puede saber, pasalo al equipo.',
].join('\n')

// ---- 7. Follow-up texts per agent ---------------------------------------------------------------------------------
type Slots = Partial<Record<'quoted' | 'size' | 'how_it_works' | 'shipping_details' | 'chose' | 'sinpe_reminder', string>>
function stageFor(emoji: string, withSize: boolean): { A: Slots; B: Slots } {
  const B: Slots = {
    quoted: `¡Hola! ${emoji} ¿Te lo dejo apartado? Decime cuántos querés y te paso el total con envío 🚚`,
    how_it_works: `¡Hola! ${emoji} ¿Te quedó claro cómo se usa? Si querés, te armo el pedido ahora mismo 🙌`,
    shipping_details: `¡Hola! ${emoji} ¿Seguimos? Solo me faltan tus datos de envío para dejar listo tu pedido 😊`,
    chose: `¡Hola! ${emoji} ¿Lo dejamos listo hoy? Te pido los datos y te llega en 2 a 3 días hábiles 🚚`,
    sinpe_reminder: `¡Hola! ${emoji} Te guardo tu pedido. Cuando hagás el SINPE, mandame el comprobante por aquí y lo dejamos listo 😊`,
  }
  const A: Slots = {
    quoted: `¡Hola! ${emoji} ¿Te lo aparto?`,
    how_it_works: `¡Hola! ${emoji} ¿Te ayudo a pedir el tuyo?`,
    shipping_details: `¡Hola! ${emoji} ¿Me pasás los datos que faltan para tu pedido?`,
    chose: `¡Hola! ${emoji} ¿Seguimos con tu pedido?`,
    sinpe_reminder: `¡Hola! ${emoji} Cuando hagás el SINPE, mandame el comprobante por aquí 😊`,
  }
  if (withSize) {
    B.size = `¡Hola! ${emoji} ¿Ya viste tu talla en la guía? Decime cuál y te dejo listo el pedido (si dudás entre dos, va la más grande).`
    A.size = `¡Hola! ${emoji} ¿Qué talla te quedó en la guía?`
  }
  return { A, B }
}
const FOLLOW_UP_TEXTS: Record<string, { A: Slots; B: Slots }> = {
  [DEEPSLEEP_AGENTS.forge]: stageFor('💪', true),
  [DEEPSLEEP_AGENTS.sleeping]: stageFor('🌙', false),
  [DEEPSLEEP_AGENTS.pura]: stageFor('😁', false),
  [DEEPSLEEP_AGENTS.prototipo]: stageFor('✈️', false),
  [DEEPSLEEP_AGENTS.patchhouse]: stageFor('🌿', false),
}

// ---- Plan / backup types -----------------------------------------------------------------------------------------
type Change =
  | { kind: 'brand_facts'; agentId: string; before: unknown; after: unknown }
  | { kind: 'sales_rules'; agentId: string; before: Partial<SalesRules>; after: Partial<SalesRules> }
  | { kind: 'shortcut'; agentId: string; shortcutId: string; key: string; before: string; after: string }
  | { kind: 'gam_doc'; agentIds: string[]; sourceId: string | null }
  | { kind: 'flag'; key: string; before: { enabled: boolean } | null; after: { enabled: boolean } }
  | { kind: 'follow_up'; flagId: string; campaignId: string; agentId: string; before: unknown; after: unknown }
type Backup = { version: 1; kind: 'deepsleep-bot-fixes-2026-11-04'; createdAt: string; tenantId: string; changes: Change[] }

const AGENT_IDS = Object.values(DEEPSLEEP_AGENTS)

async function plan(): Promise<{ changes: Change[]; errors: string[] }> {
  const changes: Change[] = []
  const errors: string[] = []
  for (const agentId of AGENT_IDS) {
    const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId: TENANT_ID }, select: { name: true, status: true, brandFacts: true } })
    if (!agent) { errors.push(`agent ${agentId} missing`); continue }
    if (agent.status !== 'live') { errors.push(`${agent.name} is ${agent.status}, expected live`); continue }
    const before = (agent.brandFacts ?? {}) as Record<string, any>
    const after = structuredClone(before)
    after.location = { ...(after.location || {}), pickupInstructions: PICKUP_INSTRUCTIONS }
    after.shipping = { ...(after.shipping || {}) }
    after.shipping.ra = { ...(after.shipping.ra || {}), enabled: true, text: PICKUP_RA_TEXT }
    after.shipping.contraEntrega = { ...(after.shipping.contraEntrega || {}), enabled: true, text: COD_TEXT }
    after.payment = { ...(after.payment || {}), instructionsText: PAY_INSTRUCTIONS }
    const methods: string[] = Array.isArray(after.payment.methods) ? after.payment.methods : []
    if (!methods.includes('contra_entrega')) after.payment.methods = [...methods, 'contra_entrega']
    // DATA-74: instructionsText is also the cash ([[PAGO_EFECTIVO]]) block — refuse an agent that offers efectivo.
    if (methods.includes('efectivo')) errors.push(`${agent.name} offers efectivo: instructionsText would print as the cash block`)
    if (agentId === DEEPSLEEP_AGENTS.forge) after.returnsText = FORGE_RETURNS
    try { parseBrandFacts(after) } catch (e) { errors.push(`${agent.name} brandFacts invalid: ${String(e).slice(0, 200)}`) }
    if (!sameJson(before, after)) changes.push({ kind: 'brand_facts', agentId, before, after })

    const { salesRules } = await loadSalesSetup(TENANT_ID, agentId)
    const rBefore: Partial<SalesRules> = { mustSay: salesRules.mustSay }
    const rAfter: Partial<SalesRules> = {}
    if (!salesRules.mustSay.includes(NEXT_STEP_RULE)) {
      if (salesRules.mustSay.length >= 10) errors.push(`${agent.name} mustSay full (10)`)
      else rAfter.mustSay = [...salesRules.mustSay, NEXT_STEP_RULE]
    }
    if (agentId === DEEPSLEEP_AGENTS.forge) {
      rBefore.promo = salesRules.promo
      rBefore.bundles = salesRules.bundles
      const promo = { ...salesRules.promo, active: true, freeShipping: true, endsAt: '2026-11-30', headline: 'Envío gratis a todo Costa Rica durante noviembre' }
      if (!sameJson(promo, salesRules.promo)) rAfter.promo = promo
      const bundles = salesRules.bundles ?? []
      if (!bundles.some((b) => b.price === 53800)) {
        if (bundles.length >= 8) errors.push('Forge bundles full (8)')
        else rAfter.bundles = [...bundles, { name: '4 arneses (2 Pack de 2)', price: 53800, shippingIncluded: true }]
      }
    }
    if (Object.keys(rAfter).length) {
      const next = { ...salesRules, ...rAfter }
      if (salesRulesOctets(next as SalesRules) > SALES_RULES_MAX_OCTETS) errors.push(`${agent.name} salesRules over ${SALES_RULES_MAX_OCTETS} bytes`)
      const onlyChanged = Object.fromEntries(Object.keys(rAfter).map((k) => [k, rBefore[k as keyof SalesRules] ?? salesRules[k as keyof SalesRules]]))
      changes.push({ kind: 'sales_rules', agentId, before: onlyChanged, after: rAfter })
    }

    if (agentId === DEEPSLEEP_AGENTS.pura) {
      const sc = await prisma.chatAgentShortcut.findFirst({ where: { tenantId: TENANT_ID, agentId, key: 'sys_payment_info' }, select: { id: true, body: true } })
      if (sc && !/¿C[oó]mo prefer[ií]s pagar\?/u.test(sc.body)) {
        changes.push({ kind: 'shortcut', agentId, shortcutId: sc.id, key: 'sys_payment_info', before: sc.body, after: `${sc.body.trimEnd()}\n\n¿Cómo preferís pagar?` })
      }
    }
  }

  // GAM doc: bound to every agent that does not have it yet.
  const existing = await prisma.chatKnowledgeSource.findFirst({ where: { tenantId: TENANT_ID, name: GAM_DOC_NAME, status: 'approved' }, select: { id: true } })
  const bound = existing
    ? (await prisma.chatAgentKnowledgeSource.findMany({ where: { tenantId: TENANT_ID, sourceId: existing.id }, select: { agentId: true } })).map((b) => b.agentId)
    : []
  const needBind = AGENT_IDS.filter((a) => !bound.includes(a))
  if (needBind.length) changes.push({ kind: 'gam_doc', agentIds: needBind, sourceId: existing?.id ?? null })

  const card = await prisma.tenantFeatureFlag.findFirst({ where: { scope: TENANT_ID, key: CARD_BY_TEAM_FLAG }, select: { enabled: true } })
  if (!card?.enabled) changes.push({ kind: 'flag', key: CARD_BY_TEAM_FLAG, before: card ? { enabled: card.enabled } : null, after: { enabled: true } })

  // Follow-ups: newest round per agent that nobody stopped.
  const fu = await prisma.tenantFeatureFlag.findFirst({ where: { key: FOLLOW_UP_FLAG, OR: [{ scope: TENANT_ID }, { tenantId: TENANT_ID }] }, select: { id: true, config: true } })
  const campaigns = ((fu?.config as { campaigns?: Array<Record<string, any>> } | null)?.campaigns ?? [])
  for (const agentId of AGENT_IDS) {
    const open = campaigns
      .filter((c) => c.agentId === agentId && !c.stoppedAt && c.active === true)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
    if (!open || !fu) { errors.push(`no open follow-up round for ${agentId}`); continue }
    const texts = FOLLOW_UP_TEXTS[agentId]
    for (const arm of ['A', 'B'] as const) {
      const parsed = parseStageTexts(texts[arm]) as Slots | null
      if (!parsed || Object.keys(parsed).length !== Object.keys(texts[arm]).length) errors.push(`follow-up ${agentId} arm ${arm}: a slot text was rejected`)
      for (const t of Object.values(texts[arm])) if (/\b(?:peso|pes[aá]s|estatura|mid[eé]s|kilos?)\b/iu.test(t ?? '')) errors.push(`follow-up ${agentId}: asks weight/height`)
    }
    if (!sameJson(open.stageTexts ?? null, texts)) {
      changes.push({ kind: 'follow_up', flagId: fu.id, campaignId: open.id, agentId, before: open.stageTexts ?? null, after: texts })
    }
  }
  return { changes, errors }
}

async function apply(changes: Change[], backup: Backup, backupPath: string, act: Awaited<ReturnType<typeof resolveNoWeightActor>>) {
  const skipped: string[] = []
  for (const ch of changes) {
    if (ch.kind === 'brand_facts') {
      const live = await prisma.chatAgent.findFirst({ where: { id: ch.agentId, tenantId: TENANT_ID }, select: { brandFacts: true } })
      if (!sameJson(live?.brandFacts ?? {}, ch.before)) { skipped.push(`brandFacts ${ch.agentId}`); continue }
      await updateChatAgent({ tenantId: TENANT_ID, agentId: ch.agentId, ...act, patch: { brandFacts: ch.after as never } })
      say(`  ✓ brandFacts ${ch.agentId}`)
    } else if (ch.kind === 'sales_rules') {
      await assertSalesSetupReady()
      const ok = await prisma.$transaction(async (tx) => {
        await lockAgentForSalesRules(tx, TENANT_ID, ch.agentId)
        const { salesRules } = await loadSalesSetup(TENANT_ID, ch.agentId, tx, true)
        for (const [k, v] of Object.entries(ch.before)) if (!sameJson(salesRules[k as keyof SalesRules], v)) return false
        await saveSalesSetup(TENANT_ID, ch.agentId, { salesRules: { ...salesRules, ...ch.after } }, act.actorUserId, tx)
        await tx.chatAgent.updateMany({ where: { id: ch.agentId, tenantId: TENANT_ID }, data: { version: { increment: 1 }, updatedBy: act.actorUserId } })
        return true
      }, SALES_RULES_TX)
      if (!ok) { skipped.push(`salesRules ${ch.agentId}`); continue }
      say(`  ✓ salesRules ${ch.agentId}: ${Object.keys(ch.after).join(', ')}`)
    } else if (ch.kind === 'shortcut') {
      const live = await prisma.chatAgentShortcut.findFirst({ where: { id: ch.shortcutId, tenantId: TENANT_ID }, select: { body: true } })
      if (live?.body !== ch.before) { skipped.push(`shortcut ${ch.key}`); continue }
      await updateShortcut({ tenantId: TENANT_ID, agentId: ch.agentId, shortcutId: ch.shortcutId, ...act, patch: { body: ch.after } })
      say(`  ✓ shortcut ${ch.key}`)
    } else if (ch.kind === 'gam_doc') {
      if (!ch.sourceId) {
        const created = await createKnowledgeSource({ tenantId: TENANT_ID, ...act, kind: 'policy', name: GAM_DOC_NAME, body: GAM_DOC_BODY })
        ch.sourceId = created.id
        writeFileSync(backupPath, JSON.stringify(backup, null, 2)) // the new id first, so a revert can find it
        await approveKnowledgeSource({ tenantId: TENANT_ID, sourceId: created.id, ...act })
      }
      for (const agentId of ch.agentIds) await bindKnowledgeToAgent({ tenantId: TENANT_ID, agentId, sourceId: ch.sourceId, ...act })
      say(`  ✓ GAM doc ${ch.sourceId} → ${ch.agentIds.length} agents`)
    } else if (ch.kind === 'flag') {
      await prisma.tenantFeatureFlag.upsert({
        where: { scope_key: { scope: TENANT_ID, key: ch.key } },
        create: { scope: TENANT_ID, tenantId: TENANT_ID, key: ch.key, enabled: true },
        update: { enabled: true },
      })
      say(`  ✓ flag ${ch.key} on`)
    } else if (ch.kind === 'follow_up') {
      const ok = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT "config" FROM "TenantFeatureFlag" WHERE "id" = ${ch.flagId} AND "key" = ${FOLLOW_UP_FLAG} AND "tenantId" = ${TENANT_ID} FOR UPDATE`
        const config = structuredClone((rows[0]?.config ?? { campaigns: [] }) as { campaigns: Array<Record<string, unknown>> })
        const c = config.campaigns.find((x) => x.id === ch.campaignId)
        if (!c || c.stoppedAt || !sameJson(c.stageTexts ?? null, ch.before)) return false
        c.stageTexts = ch.after
        await tx.tenantFeatureFlag.update({ where: { id: ch.flagId }, data: { config: config as Prisma.InputJsonValue } })
        return true
      })
      if (!ok) { skipped.push(`follow-up ${ch.campaignId}`); continue }
      say(`  ✓ follow-up texts ${ch.campaignId}`)
    }
  }
  writeFileSync(backupPath, JSON.stringify(backup, null, 2))
  return skipped
}

async function revert(path: string, act: Awaited<ReturnType<typeof resolveNoWeightActor>>) {
  const backup = JSON.parse(readFileSync(path, 'utf8')) as Backup
  if (backup.kind !== 'deepsleep-bot-fixes-2026-11-04' || backup.tenantId !== TENANT_ID) throw new Error('not a backup of this script / tenant')
  for (const ch of [...backup.changes].reverse()) {
    say(`~ revert ${ch.kind}`)
    if (!APPLY) continue
    if (ch.kind === 'brand_facts') {
      const live = await prisma.chatAgent.findFirst({ where: { id: ch.agentId, tenantId: TENANT_ID }, select: { brandFacts: true } })
      if (!sameJson(live?.brandFacts ?? {}, ch.after)) { say('  ! changed since apply — skipped'); continue }
      await updateChatAgent({ tenantId: TENANT_ID, agentId: ch.agentId, ...act, patch: { brandFacts: ch.before as never } })
    } else if (ch.kind === 'sales_rules') {
      await prisma.$transaction(async (tx) => {
        await lockAgentForSalesRules(tx, TENANT_ID, ch.agentId)
        const { salesRules } = await loadSalesSetup(TENANT_ID, ch.agentId, tx, true)
        for (const [k, v] of Object.entries(ch.after)) if (!sameJson(salesRules[k as keyof SalesRules], v)) { say('  ! changed since apply — skipped'); return }
        await saveSalesSetup(TENANT_ID, ch.agentId, { salesRules: { ...salesRules, ...ch.before } }, act.actorUserId, tx)
      }, SALES_RULES_TX)
    } else if (ch.kind === 'shortcut') {
      const live = await prisma.chatAgentShortcut.findFirst({ where: { id: ch.shortcutId, tenantId: TENANT_ID }, select: { body: true } })
      if (live?.body !== ch.after) { say('  ! changed since apply — skipped'); continue }
      await updateShortcut({ tenantId: TENANT_ID, agentId: ch.agentId, shortcutId: ch.shortcutId, ...act, patch: { body: ch.before } })
    } else if (ch.kind === 'gam_doc' && ch.sourceId) {
      for (const agentId of ch.agentIds) await unbindKnowledgeFromAgent({ tenantId: TENANT_ID, agentId, sourceId: ch.sourceId, ...act }).catch(() => null)
    } else if (ch.kind === 'flag') {
      await prisma.tenantFeatureFlag.updateMany({ where: { scope: TENANT_ID, key: ch.key }, data: { enabled: ch.before?.enabled ?? false } })
    } else if (ch.kind === 'follow_up') {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT "config" FROM "TenantFeatureFlag" WHERE "id" = ${ch.flagId} AND "key" = ${FOLLOW_UP_FLAG} AND "tenantId" = ${TENANT_ID} FOR UPDATE`
        const config = structuredClone((rows[0]?.config ?? { campaigns: [] }) as { campaigns: Array<Record<string, unknown>> })
        // The round may have renewed since: restore every round of this agent that still carries the applied texts.
        for (const c of config.campaigns) {
          if (c.agentId !== ch.agentId || !sameJson(c.stageTexts ?? null, ch.after)) continue
          if (ch.before == null) delete c.stageTexts
          else c.stageTexts = ch.before
        }
        await tx.tenantFeatureFlag.update({ where: { id: ch.flagId }, data: { config: config as Prisma.InputJsonValue } })
      })
    }
  }
  say(APPLY ? 'Reverted.' : 'Dry run (add --apply to revert).')
}

async function main() {
  await requireNoWeightTenant(arg('confirm-tenant'), TENANT_ID, DEEPSLEEP_TENANT_SLUG)
  const act = await resolveNoWeightActor(arg('actor-email') || NO_WEIGHT_ACTOR_EMAIL, TENANT_ID, 'deepsleep-bot-fixes-2026-11-04')
  const revertPath = arg('revert')
  if (revertPath) return revert(revertPath, act)
  const { changes, errors } = await plan()
  for (const ch of changes) say(`~ ${ch.kind} ${'agentId' in ch ? ch.agentId : 'key' in ch ? ch.key : ''}${ch.kind === 'follow_up' ? ` (${ch.campaignId})` : ''}`)
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
  const backup: Backup = { version: 1, kind: 'deepsleep-bot-fixes-2026-11-04', createdAt, tenantId: TENANT_ID, changes }
  const backupPath = join(dir, `deepsleep-bot-fixes-2026-11-04-backup-${createdAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(backupPath, JSON.stringify(backup, null, 2))
  say(`Backup: ${backupPath}`)
  const skipped = await apply(changes, backup, backupPath, act)
  if (skipped.length) {
    say(`! skipped (changed since plan): ${skipped.join(', ')}`)
    process.exitCode = 1
  }
  say(`Done. Revert: --revert=${backupPath} --apply`)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
