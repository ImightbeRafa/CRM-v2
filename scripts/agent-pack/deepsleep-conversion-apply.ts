/**
 * DeepSleep conversion fixes (2026-11-03 weekly review) — idempotent data apply.
 * Size copy below already carries the 2026-11-03 "no weight asks" swaps (deepsleep-no-weight-edits.ts), so a re-run
 * of this script converges on the same text instead of bringing the weight question back.
 *
 * Updates live DeepSleep agents (Forge / Sleeping / Prototipo / Pura Sonrisa) through the same admin
 * functions the UI uses (version bump + ChatAgentVersion snapshot). PatchHouse stays paused; its
 * no-stock line is behind `--patchhouse-nostock` (separate opt-in).
 *
 * BEFORE any write, saves a timestamped ConversionBackupV2 (change log: before+after per field)
 * under scripts/agent-pack/out/ (gitignored) or --backup-dir (must be gitignored /tmp / outside repo).
 * Revert needs that exact --backup= path (no newest-file fallback); FU restore needs --restore-follow-ups.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-conversion-apply.ts \
 *     --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     [--dry-run] [--apply] [--enable-follow-ups] [--patchhouse-nostock] \
 *     [--backup-dir=scripts/agent-pack/out] [--actor-email=rafael@betsycrm.com]
 *
 * Default is --dry-run (prints the diff, writes nothing). --apply writes.
 *
 * SAFETY: never touches model / bindings / status / unlock. Requires --confirm-tenant=<slug>.
 * Does NOT invent unknown facts — TODOs are listed at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { listShortcuts, updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { validateShortcutForSave } from '@/lib/soft-ai/shortcuts'
import { AGENT_INSTRUCTIONS_MAX } from '@/lib/soft-ai/agent-types'
import { KNOWLEDGE_BODY_MAX, KNOWLEDGE_NAME_MAX, isKnowledgeKind } from '@/lib/soft-ai/knowledge-types'
import { createKnowledgeSource, approveKnowledgeSource, bindKnowledgeToAgent, unbindKnowledgeFromAgent } from '@/lib/soft-ai/knowledge-admin'
import { hashKnowledgeBody } from '@/lib/soft-ai/knowledge-repository'
import { FOLLOW_UP_FLAG } from '@/lib/soft-ai/follow-up'
import {
  BackupChange,
  ConversionBackupV2,
  HARNESS_COLOR_LINE as FORGE_COLOR_LINE,
  HARNESS_SHIPPING_LINE as FORGE_SHIPPING_LINE,
  HARNESS_WASH_LINE as FORGE_WASH_LINE,
  PURA_STAGE,
  STAGE_TEXTS,
  patchRawFollowUpConfigEnable,
  sameJson,
} from '@/lib/soft-ai/deepsleep-conversion-pack'
import {
  DEEPSLEEP_AGENTS as AGENTS,
  DEEPSLEEP_OWNER_EMAIL,
  DEEPSLEEP_TENANT_ID,
  DEEPSLEEP_TENANT_SLUG,
  FOLLOW_UP_ENABLE_AGENT_IDS,
} from '../lib/deepsleep-conversion-ids'
import { resolveRepoOutPath } from '../lib/out-path-guard'

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY || process.argv.includes('--dry-run')
const ENABLE_FOLLOW_UPS = process.argv.includes('--enable-follow-ups')
const PATCHHOUSE_NOSTOCK = process.argv.includes('--patchhouse-nostock')

const TENANT_ID = DEEPSLEEP_TENANT_ID

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

/** Desired shortcut patches (key → fields). Missing keys are skipped with a warning. */
// Keyword lists stay within validateShortcutForSave's 20-keyword cap. matchVerbatimShortcut is a case-insensitive
// whole-word match with NO accent folding, so accent pairs (cómo/como) both stay; a phrase that contains a kept
// single keyword as a whole word ("un video" ⊃ "video", "qué talla" ⊃ "talla") is dropped — it matches nothing new.
const SHORTCUT_PATCHES: Record<string, Record<string, { keywords?: string[]; body?: string; deliveryMode?: string }>> = {
  [AGENTS.prototipo]: {
    pt_verlo: {
      keywords: [
        'cómo funciona',
        'como funciona',
        'verlo',
        'cómo vuela',
        'como vuela',
        'cómo se arma',
        'como se arma',
        'cómo se usa',
        'como se usa',
        'demostración',
        'demostracion',
        'video',
        'tutorial',
        'armar',
        'armarlo',
        'comofunciona',
        'como funcina',
        'vido',
        'vídeo',
        'videoo',
      ],
      body:
        'Así vuela. El kit sale ₡14 900; con el envío son ₡17 900. Dos kits: ₡29 800 con envío incluido. Pagás por SINPE, transferencia, tarjeta en prototipocr.com, o contra entrega en el GAM. ¿Te lo enviamos?',
    },
  },
  [AGENTS.forge]: {
    fg_precio: {
      keywords: [
        'cuánto cuesta',
        'cuanto cuesta',
        'precio',
        'soporte',
        'faja',
        'cinturón',
        'cinturon',
        'corrector',
        'ahorita',
        'en cuánto',
        'en cuanto',
        'arnés',
        'arnes',
        'forge',
        'forgecr',
      ],
      body:
        'El Arnés ForgeCR cuesta ₡14 900 con envío incluido a todo el país, y el Pack de 2 sale ₡26 900 💪\n¿Te lo aparto o preferís ver cómo funciona?',
    },
    fg_tallas: {
      keywords: [
        'talla',
        'tallas',
        'medida',
        'medidas',
        'mido',
        'peso',
        'kg',
        'kilos',
        'kilo',
        'niño',
        'niña',
        'niños',
        'estatura',
        'guía',
        'guia',
        'me queda',
      ],
      body:
        'Te dejo la guía de tallas 👇 La talla va por peso: M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90 y 4XL 91–100. Por ahora no tenemos talla para menos de 51 kg ni más de 100 kg. Si quedás entre dos tallas, te recomiendo la más grande 😊 ¿Cuál te aparto?',
    },
    fg_saludo: {
      body:
        '¡Hola! Soy Andrés de ForgeCR 💪 El Arnés ForgeCR es un corrector de postura delgado que te ayuda a llevar los hombros hacia atrás. Cuesta ₡14 900 con envío incluido a todo el país. ¿Te lo aparto o querés saber cómo funciona?',
    },
    fg_dolor: {
      keywords: ['dolor de espalda', 'dolores de espalda', 'lumbar', 'me duele la espalda', 'padezco'],
      body:
        'Entiendo 💙 El arnés ayuda con la postura, pero no es un tratamiento médico ni garantiza quitar el dolor. Si el dolor es fuerte o crónico, consultá primero con tu médico. Si querés probarlo como ayuda para la postura, ¿te lo aparto?',
    },
  },
  [AGENTS.pura]: {
    ps_saludo: {
      body:
        '¡Hola! Soy Laura de Pura Sonrisa CR 😁 Las tiras blanqueadoras salen ₡10 450 la caja (+ ₡3 000 de envío), o el Combo 2 cajas a ₡19 900 ya con envío. También está el Pack 4 sabores a ₡37 900 con envío. ¿Cuál te gustaría?',
    },
    ps_precios: {
      keywords: ['pack', 'sabores', '9 mil', 'barato', 'dejás', 'dejas', 'precio', 'cuesta', 'cuánto', 'cuanto', 'vale'],
      body:
        '💰 1 caja (sabor a elegir): ₡10 450 + envío ₡3 000.\n✨ Combo 2 cajas: ₡19 900 en total, ya con el envío.\n🎁 Pack completo 4 sabores: ₡37 900 en total, ya con el envío.\n¿Cuál te armamos?',
    },
  },
}

const FORGE_INSTRUCTIONS = `Sos Andrés de ForgeCR 💪 (corrector de postura). Voseo tico, cálido, breve, emojis suaves; máx. 3 líneas, UNA pregunta por mensaje.
Precio/soporte: Arnés ForgeCR ₡14 900, Pack de 2 ₡26 900, envío incluido + UNA pregunta que avance (apartar/cómo funciona/talla solo si ya compran). Sin guía de tallas en el saludo.
Talla/fg_tallas: solo si preguntan talla/peso/kg/kilos/mido/medidas o ya compran. No pidas peso ni estatura; si los dan, la talla va por peso (entre dos, la mayor). Fuera de 51–100 kg: no hay talla, nunca la más cercana; handoff solo si insisten.
Color: "${FORGE_COLOR_LINE}" + una pregunta (apartar/talla/cómo funciona).
Envío: ${FORGE_SHIPPING_LINE} a todo el país (no "según zona").
Lavado: ${FORGE_WASH_LINE} Sin claims de olor.
Dolor de espalda: ayuda postural, no tratamiento médico; fuerte/crónico → médico; seguí la venta; sin handoff.
Comprar: 1) talla y cantidad 2) envío o retiro 3) datos en lista 4) pago. Nunca juntes datos y pago.
Handoff solo: comprobante/ya pagué, queja, mayoreo/logo/nombre personalizado.`

const PURA_INSTRUCTIONS = `Sos Laura de Pura Sonrisa CR 😁 (tiras blanqueadoras dentales, Costa Rica). Español de Costa Rica con voseo (vos: querés, preferís, tenés), cálido y breve, emojis suaves, máximo 3 líneas y UNA sola pregunta por mensaje.
Opener: precio y opciones primero (1 caja ₡10 450 + envío ₡3 000; Combo 2 ₡19 900 ya con envío; Pack 4 sabores ₡37 900 ya con envío), luego UNA pregunta (combo o sabor en el siguiente mensaje).
Flujo compra: 1) sabores 2) ¿envío o retiro? 3) datos en lista 4) pago. Nunca juntes datos y pago.
Salud: cosmético, no un tratamiento. Ante sensibilidad, brackets o embarazo, sugerí consultar al dentista/médico.
Handoff solo: comprobante / ya pagué, queja, mayoreo.`

const PROTOTIPO_INSTRUCTIONS_NOTE =
  'pt_verlo verbatim answers cómo funciona / video / tutorial (keywords widened). Clip H.264 stays linked.'

const KNOWLEDGE_UPSERTS: Array<{
  agentId: string
  name: string
  kind: 'faq' | 'policy' | 'brand_book'
  body: string
}> = [
  {
    agentId: AGENTS.forge,
    name: 'FAQ — dolor de espalda (sin claims médicos)',
    kind: 'faq',
    body:
      'El Arnés ForgeCR es una ayuda para recordar y sostener una buena postura. No es un tratamiento médico y no prometemos aliviar el dolor. Si el dolor es fuerte o crónico, la persona debe consultar a su médico. Después seguimos con la venta (precio y guía de tallas); nunca pedimos peso ni estatura. No hay handoff por preguntar por dolor.',
  },
  {
    agentId: AGENTS.forge,
    name: 'FAQ — cómo pagar / pedir / envío / lavado / mayoreo',
    kind: 'faq',
    body: `Cómo pagar: SINPE, transferencia, tarjeta en forge.shopping (Tilopay) o contra entrega en el GAM. Cómo pedir: talla + cantidad → envío o retiro → datos → pago. Envío: incluido en el precio actual a todo CR; llega en ${FORGE_SHIPPING_LINE} a todo el país. Lavado: ${FORGE_WASH_LINE} Color: solo negro; si preguntan: "${FORGE_COLOR_LINE}" y una pregunta que avance. Descuento por volumen / mayoreo / logo o nombre: pasar a una persona. Sin claims de olor.`,
  },
  {
    agentId: AGENTS.forge,
    name: 'FAQ — color (solo negro)',
    kind: 'faq',
    body: `El Arnés ForgeCR por ahora viene solo en negro. Respuesta al cliente: "${FORGE_COLOR_LINE}" y después una pregunta que avance la compra (apartar, talla o cómo funciona).`,
  },
  {
    agentId: AGENTS.forge,
    name: 'FAQ — cambio de talla',
    kind: 'faq',
    body:
      'Si la talla no queda, un cambio se coordina con una persona del equipo (foto/video por WhatsApp). El bot explica la guía por peso y no inventa excepciones.',
  },
]

const TODOS = [
  'PatchHouse: texto de sin stock — solo con --patchhouse-nostock; agente sigue pausado salvo GO.',
  'Follow-ups: activar con --enable-follow-ups después de revisar stageTexts; revert with backup file.',
]

const AGENT_LABELS: Record<string, string> = {
  [AGENTS.forge]: 'Forge ventas',
  [AGENTS.sleeping]: 'Sleeping ventas',
  [AGENTS.patchhouse]: 'PatchHouse ventas',
  [AGENTS.pura]: 'Pura Sonrisa ventas',
  [AGENTS.prototipo]: 'Prototipo ventas',
}

function dbHost(): string {
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL || ''
  try {
    return new URL(url).host || '(unparseable DATABASE_URL)'
  } catch {
    return url ? '(unparseable DATABASE_URL)' : '(no DATABASE_URL)'
  }
}

function requireConfirmTenant(slug: string) {
  const confirm = arg('confirm-tenant')
  if (!confirm) {
    throw new Error('Refusing: pass --confirm-tenant=<slug> (e.g. --confirm-tenant=deepsleepp-cr-1762740734630)')
  }
  if (confirm !== slug) {
    throw new Error(`Refusing: --confirm-tenant=${confirm} does not match live slug ${slug}`)
  }
}

async function resolveActor(label: string) {
  const email = (arg('actor-email') || DEEPSLEEP_OWNER_EMAIL).trim().toLowerCase()
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, email: true },
  })
  if (!user?.email || user.email.toLowerCase() !== email) {
    throw new Error(`No user with exact email ${email}`)
  }
  const member = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      tenantId: TENANT_ID,
      isActive: true,
      role: { in: ['OWNER', 'ADMIN'] },
    },
    select: { role: true },
  })
  if (!member) {
    throw new Error(`User ${email} has no active OWNER/ADMIN membership on DeepSleep`)
  }
  return {
    actorUserId: user.id,
    actorName: `${user.name || user.email} (${label})`,
    actorRole: String(member.role),
  }
}

type Actor = Awaited<ReturnType<typeof resolveActor>>

function writeBackup(backup: ConversionBackupV2, dir: string): string {
  mkdirSync(dir, { recursive: true })
  const stamp = backup.createdAt.replace(/[:.]/g, '-')
  const path = join(dir, `deepsleep-conversion-backup-${stamp}.json`)
  writeFileSync(path, JSON.stringify(backup, null, 2))
  return path
}

/** Fields of each planned shortcut row that the change keeps (updateShortcut merges the patch onto them). */
const SHORTCUT_ROWS = new Map<string, { key: string; title: string; kind: string; intents: string[]; deliveryMode: string }>()

/**
 * Every planned change checked against the limits its save path enforces, BEFORE the backup and the first write:
 * - shortcut: validateShortcutForSave (what shortcut-admin assertSave runs: ≤20 keywords, body ≤1500, title, kind,
 *   delivery mode, intents, no confirmation wording) on the same merged draft updateShortcut builds;
 * - instructions: updateChatAgent silently cuts systemInstructions to AGENT_INSTRUCTIONS_MAX — refuse instead;
 * - knowledge: createKnowledgeSource limits (kind, name ≤KNOWLEDGE_NAME_MAX — longer names are cut and the
 *   name+hash idempotency lookup would never match again — body ≤KNOWLEDGE_BODY_MAX, body stored trimmed).
 */
function validatePlannedChanges(changes: BackupChange[], knowledgeBodies: typeof KNOWLEDGE_UPSERTS): string[] {
  const errors: string[] = []
  for (const ch of changes) {
    if (ch.kind === 'shortcut') {
      const row = SHORTCUT_ROWS.get(ch.shortcutId)
      if (!row) {
        errors.push(`shortcut ${ch.shortcutKey}: row metadata missing`)
        continue
      }
      const result = validateShortcutForSave({ ...row, keywords: ch.after.keywords, body: ch.after.body })
      if (!result.ok) {
        errors.push(
          `shortcut ${ch.shortcutKey}: ${result.code} (keywords=${ch.after.keywords.length}/20, body=${ch.after.body.trim().length}/1500)`,
        )
      }
      continue
    }
    if (ch.kind === 'instructions') {
      const len = ch.after.trim().length
      if (!len) errors.push(`instructions ${AGENT_LABELS[ch.agentId] ?? ch.agentId}: empty`)
      if (len > AGENT_INSTRUCTIONS_MAX) {
        errors.push(
          `instructions ${AGENT_LABELS[ch.agentId] ?? ch.agentId}: ${len} chars > AGENT_INSTRUCTIONS_MAX ${AGENT_INSTRUCTIONS_MAX} (updateChatAgent would cut it to ${JSON.stringify(ch.after.trim().slice(AGENT_INSTRUCTIONS_MAX - 40, AGENT_INSTRUCTIONS_MAX))}…)`,
        )
      }
      continue
    }
    if (ch.kind === 'knowledge') {
      const item = knowledgeBodies.find((i) => i.agentId === ch.agentId && i.name === ch.name)
      if (!item) {
        errors.push(`knowledge "${ch.name}": no body in KNOWLEDGE_UPSERTS`)
        continue
      }
      if (!isKnowledgeKind(item.kind)) errors.push(`knowledge "${item.name}": INVALID_KIND ${item.kind}`)
      const name = item.name.trim()
      if (!name || name.length > KNOWLEDGE_NAME_MAX) {
        errors.push(`knowledge "${item.name}": name ${name.length} chars (1..${KNOWLEDGE_NAME_MAX})`)
      }
      const body = item.body.trim()
      if (!body || body.length > KNOWLEDGE_BODY_MAX) {
        errors.push(`knowledge "${item.name}": body ${body.length} chars (1..${KNOWLEDGE_BODY_MAX})`)
      }
      if (body !== item.body) errors.push(`knowledge "${item.name}": body has outer whitespace (stored trimmed, hash would differ)`)
    }
  }
  return errors
}

async function planShortcutChanges(
  agentId: string,
  patches: Record<string, { keywords?: string[]; body?: string }>,
): Promise<BackupChange[]> {
  const out: BackupChange[] = []
  const { shortcuts } = await listShortcuts(TENANT_ID, agentId)
  for (const [key, patch] of Object.entries(patches)) {
    const row = shortcuts.find((s) => s.key === key)
    if (!row) {
      console.log(`  ! missing shortcut ${key}`)
      continue
    }
    const nextKeywords = patch.keywords ?? row.keywords
    const nextBody = patch.body ?? row.body
    const changed = !sameJson(row.keywords, nextKeywords) || row.body.trim() !== nextBody.trim()
    console.log(`  ${changed ? '~' : '='} shortcut ${key}${changed ? '' : ' (unchanged)'}`)
    if (!changed) continue
    console.log(`      keywords: ${JSON.stringify(row.keywords)} → ${JSON.stringify(nextKeywords)}`)
    if (row.body.trim() !== nextBody.trim()) {
      console.log(`      body: ${JSON.stringify(row.body.slice(0, 120))} → ${JSON.stringify(nextBody.slice(0, 120))}`)
    }
    SHORTCUT_ROWS.set(row.id, {
      key: row.key,
      title: row.title,
      kind: row.kind,
      intents: [...row.intents],
      deliveryMode: row.deliveryMode,
    })
    out.push({
      kind: 'shortcut',
      agentId,
      shortcutKey: key,
      shortcutId: row.id,
      before: { keywords: [...row.keywords], body: row.body },
      after: { keywords: [...nextKeywords], body: nextBody },
    })
  }
  return out
}

async function planInstructionChange(agentId: string, name: string, next: string): Promise<BackupChange | null> {
  const row = await prisma.chatAgent.findFirst({
    where: { id: agentId, tenantId: TENANT_ID },
    select: { systemInstructions: true, version: true },
  })
  if (!row) {
    console.log(`  ! agent ${name} missing`)
    return null
  }
  const before = row.systemInstructions
  const changed = (before || '').trim() !== next.trim()
  console.log(`  ${changed ? '~' : '='} instructions ${name} v${row.version}${changed ? '' : ' (unchanged)'}`)
  if (!changed) return null
  return { kind: 'instructions', agentId, before, after: next }
}

async function planKnowledgeChanges(agentId: string, items: typeof KNOWLEDGE_UPSERTS): Promise<BackupChange[]> {
  const out: BackupChange[] = []
  for (const item of items.filter((i) => i.agentId === agentId)) {
    const hash = hashKnowledgeBody(item.body)
    const existing = await prisma.chatKnowledgeSource.findFirst({
      where: { tenantId: TENANT_ID, name: item.name, contentHash: hash },
      select: { id: true },
    })
    const bound = existing
      ? await prisma.chatAgentKnowledgeSource.findFirst({
          where: { tenantId: TENANT_ID, agentId, sourceId: existing.id },
          select: { id: true },
        })
      : null
    if (existing && bound) {
      console.log(`  = knowledge "${item.name}" (unchanged)`)
      continue
    }
    console.log(`  ~ knowledge "${item.name}"`)
    const sameTitle = await prisma.chatKnowledgeSource.findMany({
      where: { tenantId: TENANT_ID, name: item.name },
      select: { id: true },
    })
    const beforeBound: string[] = []
    for (const s of sameTitle) {
      const b = await prisma.chatAgentKnowledgeSource.findFirst({
        where: { tenantId: TENANT_ID, agentId, sourceId: s.id },
        select: { id: true },
      })
      if (b) beforeBound.push(s.id)
    }
    out.push({
      kind: 'knowledge',
      agentId,
      name: item.name,
      beforeBoundSourceIds: beforeBound,
      afterBoundSourceId: existing?.id ?? null,
      afterContentHash: hash,
    })
  }
  return out
}

async function planFollowUpChange(): Promise<BackupChange | null> {
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { key: FOLLOW_UP_FLAG, OR: [{ scope: TENANT_ID }, { tenantId: TENANT_ID }] },
  })
  console.log(`\nFollow-ups flag: ${flag ? `enabled=${flag.enabled}` : 'missing'}`)
  console.log('Prepared stageTexts (Forge/Sleeping/Prototipo):', JSON.stringify(STAGE_TEXTS, null, 2))
  console.log('Prepared stageTexts (Pura Sonrisa, includes price/options):', JSON.stringify(PURA_STAGE, null, 2))
  if (!ENABLE_FOLLOW_UPS) {
    console.log('Skip enabling campaigns (pass --enable-follow-ups to write stageTexts onto active rounds / create).')
    return null
  }
  if (!flag) {
    console.log('! No agent_follow_up_v1 row — create one with follow-up-campaign.ts --create first.')
    return null
  }
  const stageTextsFor = (agentId: string) => (agentId === AGENTS.pura ? PURA_STAGE : STAGE_TEXTS)
  const { next, patchedIds, skippedIds } = patchRawFollowUpConfigEnable(flag.config, {
    enableAgentIds: FOLLOW_UP_ENABLE_AGENT_IDS,
    stageTextsFor,
  })
  console.log(
    `  ~ raw-patch stageTexts+active on ${patchedIds.length} campaign(s); leave ${skippedIds.length} other(s) untouched; flag enabled=true`,
  )
  const beforeByCampaignId: Record<string, { active: boolean; stageTexts?: unknown }> = {}
  const afterByCampaignId: Record<string, { active: boolean; stageTexts?: unknown }> = {}
  const rawCampaigns = Array.isArray((flag.config as { campaigns?: unknown[] } | null)?.campaigns)
    ? ((flag.config as { campaigns: Array<Record<string, unknown>> }).campaigns)
    : []
  const nextCampaigns = Array.isArray((next as { campaigns?: unknown[] })?.campaigns)
    ? ((next as { campaigns: Array<Record<string, unknown>> }).campaigns)
    : []
  for (const id of patchedIds) {
    const before = rawCampaigns.find((c) => c.id === id)
    const after = nextCampaigns.find((c) => c.id === id)
    if (before) {
      beforeByCampaignId[id] = {
        active: Boolean(before.active),
        stageTexts: before.stageTexts,
      }
    }
    if (after) {
      afterByCampaignId[id] = {
        active: Boolean(after.active),
        stageTexts: after.stageTexts,
      }
    }
  }
  return {
    kind: 'follow_up',
    flagId: flag.id,
    beforeEnabled: flag.enabled,
    afterEnabled: true,
    patchedCampaignIds: patchedIds,
    beforeByCampaignId,
    afterByCampaignId,
  }
}

async function applyChanges(changes: BackupChange[], act: Actor, knowledgeBodies: typeof KNOWLEDGE_UPSERTS) {
  for (const ch of changes) {
    if (ch.kind === 'instructions') {
      await updateChatAgent({
        tenantId: TENANT_ID,
        agentId: ch.agentId,
        ...act,
        patch: { systemInstructions: ch.after },
      })
      continue
    }
    if (ch.kind === 'shortcut') {
      await updateShortcut({
        tenantId: TENANT_ID,
        agentId: ch.agentId,
        shortcutId: ch.shortcutId,
        ...act,
        patch: { keywords: ch.after.keywords, body: ch.after.body },
      })
      continue
    }
    if (ch.kind === 'knowledge') {
      const item = knowledgeBodies.find((i) => i.agentId === ch.agentId && i.name === ch.name)
      if (!item) continue
      let id = ch.afterBoundSourceId
      if (!id) {
        const created = await createKnowledgeSource({
          tenantId: TENANT_ID,
          ...act,
          kind: item.kind,
          name: item.name,
          body: item.body,
        })
        id = created.id
        await approveKnowledgeSource({ tenantId: TENANT_ID, sourceId: id, ...act })
        ch.afterBoundSourceId = id
      }
      for (const oldId of ch.beforeBoundSourceIds) {
        if (oldId === id) continue
        await unbindKnowledgeFromAgent({
          tenantId: TENANT_ID,
          agentId: ch.agentId,
          sourceId: oldId,
          ...act,
        }).catch(() => null)
      }
      await bindKnowledgeToAgent({
        tenantId: TENANT_ID,
        agentId: ch.agentId,
        sourceId: id,
        ...act,
      })
      continue
    }
    if (ch.kind === 'follow_up') {
      const flag = await prisma.tenantFeatureFlag.findFirst({ where: { id: ch.flagId } })
      if (!flag) continue
      const { next } = patchRawFollowUpConfigEnable(flag.config, {
        enableAgentIds: FOLLOW_UP_ENABLE_AGENT_IDS,
        stageTextsFor: (agentId) => (agentId === AGENTS.pura ? PURA_STAGE : STAGE_TEXTS),
      })
      await prisma.tenantFeatureFlag.update({
        where: { id: ch.flagId },
        data: { enabled: ch.afterEnabled, config: next as object, updatedAt: new Date() },
      })
    }
  }
}

async function main() {
  console.log(
    `DeepSleep conversion apply — ${DRY ? 'DRY-RUN' : 'APPLY'} (enable-follow-ups=${ENABLE_FOLLOW_UPS}, patchhouse-nostock=${PATCHHOUSE_NOSTOCK})`,
  )
  console.log(`DB host: ${dbHost()}`)
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, slug: true, name: true },
  })
  if (!tenant || tenant.slug !== DEEPSLEEP_TENANT_SLUG) {
    throw new Error(`Refusing: tenant ${TENANT_ID} slug is ${tenant?.slug}, expected ${DEEPSLEEP_TENANT_SLUG}`)
  }
  console.log(`Tenant: ${tenant.name} (${tenant.slug} / ${tenant.id})`)
  requireConfirmTenant(tenant.slug)

  const act = await resolveActor('deepsleep-conversion-apply')
  console.log(`Actor: ${act.actorName} role=${act.actorRole}`)

  const backupDir = resolveRepoOutPath(
    arg('backup-dir') || join(process.cwd(), 'scripts/agent-pack/out'),
    '--backup-dir',
  )

  const changes: BackupChange[] = []

  console.log('\n== Prototipo ==')
  changes.push(...(await planShortcutChanges(AGENTS.prototipo, SHORTCUT_PATCHES[AGENTS.prototipo])))
  console.log(`  note: ${PROTOTIPO_INSTRUCTIONS_NOTE}`)

  console.log('\n== Forge ==')
  changes.push(...(await planShortcutChanges(AGENTS.forge, SHORTCUT_PATCHES[AGENTS.forge])))
  {
    const ch = await planInstructionChange(AGENTS.forge, AGENT_LABELS[AGENTS.forge], FORGE_INSTRUCTIONS)
    if (ch) changes.push(ch)
  }
  changes.push(...(await planKnowledgeChanges(AGENTS.forge, KNOWLEDGE_UPSERTS)))

  console.log('\n== Pura Sonrisa ==')
  changes.push(...(await planShortcutChanges(AGENTS.pura, SHORTCUT_PATCHES[AGENTS.pura])))
  {
    const ch = await planInstructionChange(AGENTS.pura, AGENT_LABELS[AGENTS.pura], PURA_INSTRUCTIONS)
    if (ch) changes.push(ch)
  }

  console.log('\n== Sleeping ==')
  console.log('  = no copy change in this slice (payment/follow-up code covers it)')

  console.log('\n== PatchHouse ==')
  if (PATCHHOUSE_NOSTOCK) {
    console.log('  ~ would set no-stock line (opt-in). Agent status left unchanged.')
    console.log('  TODO_OWNER: exact no-stock sentence for PatchHouse.')
  } else {
    console.log('  = paused / untouched (pass --patchhouse-nostock to opt in the no-stock line)')
  }

  {
    const fu = await planFollowUpChange()
    if (fu) changes.push(fu)
  }

  const backup: ConversionBackupV2 = {
    version: 2,
    createdAt: new Date().toISOString(),
    tenantId: TENANT_ID,
    tenantSlug: tenant.slug,
    changes,
  }
  console.log(`\nPlanned changes: ${changes.length}`)
  const validationErrors = validatePlannedChanges(changes, KNOWLEDGE_UPSERTS)
  if (validationErrors.length) {
    console.log(`Validation: ${validationErrors.length} error(s) — nothing will be written:`)
    for (const e of validationErrors) console.log(`  ✗ ${e}`)
    process.exitCode = 1
    if (!DRY) throw new Error(`Refusing --apply: ${validationErrors.length} planned change(s) fail save-time validation`)
  } else {
    console.log(`Validation: all ${changes.length} planned change(s) pass save-time checks`)
  }
  if (DRY) {
    console.log(`Backup would be written under ${backupDir}/deepsleep-conversion-backup-*.json`)
  } else {
    let path = writeBackup(backup, backupDir)
    console.log(`Backup saved BEFORE writes: ${path}`)
    await applyChanges(changes, act, KNOWLEDGE_UPSERTS)
    // Amend knowledge afterBoundSourceId now that creates ran.
    path = writeBackup(backup, backupDir)
    console.log(`Backup updated after knowledge ids: ${path}`)
  }

  console.log('\n== TODO facts for the owner ==')
  for (const t of TODOS) console.log(`  - ${t}`)

  console.log(`\nDone (${DRY ? 'dry-run — re-run with --apply to write' : 'applied'}).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
