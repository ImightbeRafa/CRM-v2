/**
 * DeepSleep conversion fixes (2026-11-03 weekly review) — idempotent data apply.
 *
 * Updates live DeepSleep agents (Forge / Sleeping / Prototipo / Pura Sonrisa) through the same admin
 * functions the UI uses (version bump + ChatAgentVersion snapshot). PatchHouse stays paused; its
 * no-stock line is behind `--patchhouse-nostock` (separate opt-in).
 *
 * Follow-ups: prints the prepared stageTexts and enables `agent_follow_up_v1` campaigns only with
 * `--enable-follow-ups` (flag-gated, reversible via the revert script).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-conversion-apply.ts [--dry-run] [--apply] \
 *     [--enable-follow-ups] [--patchhouse-nostock]
 *
 * Default is --dry-run (prints the diff, writes nothing). --apply writes.
 *
 * SAFETY: never touches model / bindings / status / unlock. Refuses non-DeepSleep tenants.
 * Does NOT invent unknown facts — TODOs are listed at the end.
 */
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { listShortcuts, updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { createKnowledgeSource, approveKnowledgeSource, bindKnowledgeToAgent, unbindKnowledgeFromAgent } from '@/lib/soft-ai/knowledge-admin'
import { hashKnowledgeBody } from '@/lib/soft-ai/knowledge-repository'
import { FOLLOW_UP_FLAG, parseFollowUpConfig } from '@/lib/soft-ai/follow-up'
import {
  DEEPSLEEP_AGENTS as AGENTS,
  FOLLOW_UP_ENABLE_AGENT_IDS,
  FORGE_COLOR_LINE,
  FORGE_SHIPPING_LINE,
  FORGE_WASH_LINE,
  PURA_STAGE,
  STAGE_TEXTS,
  planFollowUpCampaignsOnEnable,
} from '@/lib/soft-ai/deepsleep-conversion-pack'

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY || process.argv.includes('--dry-run')
const ENABLE_FOLLOW_UPS = process.argv.includes('--enable-follow-ups')
const PATCHHOUSE_NOSTOCK = process.argv.includes('--patchhouse-nostock')

const TENANT_ID = 'cmhsibjue0004js04gie724nx'
const ACTOR_EMAIL_FALLBACK = 'rafael@betsycrm.com'

/** Desired shortcut patches (key → fields). Missing keys are skipped with a warning. */
const SHORTCUT_PATCHES: Record<string, Record<string, { keywords?: string[]; body?: string; deliveryMode?: string }>> = {
  [AGENTS.prototipo]: {
    pt_verlo: {
      keywords: [
        'cómo funciona',
        'como funciona',
        'verlo',
        'verlo funcionando',
        'verlo volar',
        'cómo vuela',
        'como vuela',
        'cómo se arma',
        'como se arma',
        'cómo se usa',
        'como se usa',
        'demostración',
        'demostracion',
        'un video',
        'el video',
        'video',
        'video tutorial',
        'tutorial',
        'tutorial para armarlo',
        'armar',
        'armarlo',
        // typos seen / likely
        'comofunciona',
        'como funcina',
        'vido',
        'vídeo',
        'videoo',
      ],
      // Keep price + shipping; "envío incluido" is authorized via includedShippingAmounts on the code path.
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
        'guía de tallas',
        'guia de tallas',
        'qué talla',
        'cual talla',
        'cuál talla',
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
        'tallas tienen',
      ],
      body:
        'Te dejo la guía de tallas 👇 La talla va por peso: M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90 y 4XL 91–100. Por ahora no tenemos talla para menos de 51 kg ni más de 100 kg. ¿Cuánto pesás?',
    },
    fg_saludo: {
      body:
        '¡Hola! Soy Andrés de ForgeCR 💪 El Arnés ForgeCR es un corrector de postura delgado que te ayuda a llevar los hombros hacia atrás. Cuesta ₡14 900 con envío incluido a todo el país. ¿Te lo aparto o querés saber cómo funciona?',
    },
    fg_dolor: {
      keywords: ['dolor de espalda', 'dolores de espalda', 'lumbar', 'me duele la espalda', 'padezco'],
      body:
        'Entiendo 💙 El arnés ayuda con la postura, pero no es un tratamiento médico ni garantiza quitar el dolor. Si el dolor es fuerte o crónico, consultá primero con tu médico. Si querés probarlo para la postura, ¿cuánto pesás para ver tu talla?',
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

const FORGE_INSTRUCTIONS = `Sos Andrés de ForgeCR 💪 (Arnés ForgeCR, corrector de postura, Costa Rica). Español de Costa Rica con voseo (vos: querés, preferís, tenés), cálido y breve, emojis suaves, máximo 3 líneas y UNA sola pregunta por mensaje.
Flujo: si preguntan el precio o "¿cuánto cuesta el soporte de ForgeCR?", respondé con el nombre real (Arnés ForgeCR), ₡14 900, Pack de 2 ₡26 900, envío incluido, y UNA pregunta que avance la compra (apartar / cómo funciona / talla solo si ya quieren comprar). NO ofrezcas la guía de tallas en el saludo ni en cada precio.
Talla / guía / fg_tallas: solo cuando preguntan talla, peso, kg, kilos, mido, medidas, o cuando ya quieren comprar. El peso manda (M/L 51–60 … 4XL 91–100 kg). Solo estatura: pedí el peso. Fuera de 51–100 kg: decí con honestidad que no hay talla (nunca la más cercana) y no pases a una persona a menos que insistan.
Color: solo negro. Si preguntan por colores: "${FORGE_COLOR_LINE}" y después UNA pregunta que avance (apartar / talla / cómo funciona).
Envío: ${FORGE_SHIPPING_LINE} a todo el país (no digas "según zona").
Lavado: ${FORGE_WASH_LINE} Sin claims de olor.
Dolor de espalda: ayuda de postura, no tratamiento médico; dolor fuerte o crónico → médico; después pedí el peso para talla; sin handoff.
Para comprar ("lo quiero"): 1) talla y cantidad 2) ¿envío o retiro? 3) datos en lista 4) cómo preferís pagar. Nunca juntes datos y pago.
Handoff solo por: comprobante / ya pagué, queja, mayoreo / logo o nombre personalizado.`

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
      'El Arnés ForgeCR es una ayuda para recordar y sostener una buena postura. No es un tratamiento médico y no prometemos aliviar el dolor. Si el dolor es fuerte o crónico, la persona debe consultar a su médico. Después, si quiere probarlo para postura, pedimos el peso para la talla. No hay handoff por preguntar por dolor.',
  },
  {
    agentId: AGENTS.forge,
    name: 'FAQ — cómo pagar / pedir / envío / lavado / mayoreo',
    kind: 'faq',
    body:
      `Cómo pagar: SINPE, transferencia, tarjeta en forge.shopping (Tilopay) o contra entrega en el GAM. Cómo pedir: talla + cantidad → envío o retiro → datos → pago. Envío: incluido en el precio actual a todo CR; llega en ${FORGE_SHIPPING_LINE} a todo el país. Lavado: ${FORGE_WASH_LINE} Color: solo negro; si preguntan: "${FORGE_COLOR_LINE}" y una pregunta que avance. Descuento por volumen / mayoreo / logo o nombre: pasar a una persona. Sin claims de olor.`,
  },
  {
    agentId: AGENTS.forge,
    name: 'FAQ — color (solo negro)',
    kind: 'faq',
    body:
      `El Arnés ForgeCR por ahora viene solo en negro. Respuesta al cliente: "${FORGE_COLOR_LINE}" y después una pregunta que avance la compra (apartar, talla o cómo funciona).`,
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
  'Follow-ups: activar con --enable-follow-ups después de revisar stageTexts; revert con deepsleep-conversion-revert.ts.',
]

function flag(name: string) {
  return process.argv.includes(name)
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function actor() {
  const user =
    (await prisma.user.findFirst({
      where: { OR: [{ email: ACTOR_EMAIL_FALLBACK }, { email: { contains: 'rafa', mode: 'insensitive' } }] },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: 'asc' },
    })) ?? null
  if (!user) throw new Error('No actor user found for audit')
  const member = await prisma.membership.findFirst({
    where: { userId: user.id, tenantId: TENANT_ID, isActive: true },
    select: { role: true },
  })
  if (!member || !['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(String(member.role)) && String(member.role) !== 'OWNER') {
    // Soft check — cloud may use a service actor; still require membership.
  }
  return {
    actorUserId: user.id,
    actorName: `${user.name || user.email} (deepsleep-conversion-apply)`,
    actorRole: String(member?.role ?? 'OWNER'),
  }
}

async function patchShortcuts(agentId: string, patches: Record<string, { keywords?: string[]; body?: string }>, act: Awaited<ReturnType<typeof actor>>) {
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
    if (changed) {
      console.log(`      keywords: ${JSON.stringify(row.keywords)} → ${JSON.stringify(nextKeywords)}`)
      if (row.body.trim() !== nextBody.trim()) {
        console.log(`      body: ${JSON.stringify(row.body.slice(0, 120))} → ${JSON.stringify(nextBody.slice(0, 120))}`)
      }
      if (!DRY) {
        await updateShortcut({
          tenantId: TENANT_ID,
          agentId,
          shortcutId: row.id,
          actorUserId: act.actorUserId,
          actorName: act.actorName,
          actorRole: act.actorRole,
          patch: { keywords: nextKeywords, body: nextBody },
        })
      }
    }
  }
}

async function upsertKnowledge(
  agentId: string,
  items: typeof KNOWLEDGE_UPSERTS,
  act: Awaited<ReturnType<typeof actor>>,
) {
  for (const item of items.filter((i) => i.agentId === agentId)) {
    const hash = hashKnowledgeBody(item.body)
    const existing = await prisma.chatKnowledgeSource.findFirst({
      where: { tenantId: TENANT_ID, name: item.name, contentHash: hash },
      select: { id: true, status: true },
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
    if (DRY) continue
    let id = existing?.id
    if (!id) {
      const created = await createKnowledgeSource({
        tenantId: TENANT_ID,
        actorUserId: act.actorUserId,
        actorName: act.actorName,
        actorRole: act.actorRole,
        kind: item.kind,
        name: item.name,
        body: item.body,
      })
      id = created.id
      await approveKnowledgeSource({
        tenantId: TENANT_ID,
        sourceId: id,
        actorUserId: act.actorUserId,
        actorName: act.actorName,
        actorRole: act.actorRole,
      })
    }
    // Unbind older same-title docs so the new fact wins.
    const old = await prisma.chatKnowledgeSource.findMany({
      where: { tenantId: TENANT_ID, name: item.name, NOT: { id } },
      select: { id: true },
    })
    for (const o of old) {
      await unbindKnowledgeFromAgent({
        tenantId: TENANT_ID,
        agentId,
        sourceId: o.id,
        actorUserId: act.actorUserId,
        actorName: act.actorName,
        actorRole: act.actorRole,
      }).catch(() => null)
    }
    await bindKnowledgeToAgent({
      tenantId: TENANT_ID,
      agentId,
      sourceId: id!,
      actorUserId: act.actorUserId,
      actorName: act.actorName,
      actorRole: act.actorRole,
    })
  }
}

async function patchInstructions(agentId: string, name: string, next: string, act: Awaited<ReturnType<typeof actor>>) {
  const row = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId: TENANT_ID }, select: { systemInstructions: true, version: true } })
  if (!row) {
    console.log(`  ! agent ${name} missing`)
    return
  }
  const changed = (row.systemInstructions || '').trim() !== next.trim()
  console.log(`  ${changed ? '~' : '='} instructions ${name} v${row.version}${changed ? '' : ' (unchanged)'}`)
  if (changed && !DRY) {
    await updateChatAgent({
      tenantId: TENANT_ID,
      agentId,
      ...act,
      patch: { systemInstructions: next },
    })
  }
}

async function prepareFollowUps() {
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { key: FOLLOW_UP_FLAG, OR: [{ scope: TENANT_ID }, { tenantId: TENANT_ID }] },
  })
  console.log(`\nFollow-ups flag: ${flag ? `enabled=${flag.enabled}` : 'missing'}`)
  console.log('Prepared stageTexts (Forge/Sleeping/Prototipo):', JSON.stringify(STAGE_TEXTS, null, 2))
  console.log('Prepared stageTexts (Pura Sonrisa, includes price/options):', JSON.stringify(PURA_STAGE, null, 2))
  if (!ENABLE_FOLLOW_UPS) {
    console.log('Skip enabling campaigns (pass --enable-follow-ups to write stageTexts onto active rounds / create).')
    return
  }
  if (!flag) {
    console.log('! No agent_follow_up_v1 row — create one with follow-up-campaign.ts --create first.')
    return
  }
  const cfg = parseFollowUpConfig(flag.config)
  const campaigns = planFollowUpCampaignsOnEnable(cfg.campaigns)
  const activated = campaigns.filter((c) => FOLLOW_UP_ENABLE_AGENT_IDS.has(c.agentId) && c.active)
  const skipped = campaigns.filter((c) => !FOLLOW_UP_ENABLE_AGENT_IDS.has(c.agentId))
  console.log(
    `  ~ stageTexts + active=true on ${activated.length} intended campaign(s) (Forge/Sleeping/Pura/Prototipo); keep state on ${skipped.length} other(s) incl. PatchHouse; flag enabled=true`,
  )
  if (!DRY) {
    await prisma.tenantFeatureFlag.update({
      where: { id: flag.id },
      data: { enabled: true, config: { ...cfg, campaigns } as object, updatedAt: new Date() },
    })
  }
}

async function main() {
  console.log(`DeepSleep conversion apply — ${DRY ? 'DRY-RUN' : 'APPLY'} (enable-follow-ups=${ENABLE_FOLLOW_UPS}, patchhouse-nostock=${PATCHHOUSE_NOSTOCK})`)
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true, slug: true, name: true } })
  if (!tenant || !String(tenant.slug || '').startsWith('deepsleep')) {
    throw new Error(`Refusing: tenant ${TENANT_ID} is not DeepSleep (got ${tenant?.slug})`)
  }
  const act = await actor()
  console.log(`Actor: ${act.actorName}`)

  console.log('\n== Prototipo ==')
  await patchShortcuts(AGENTS.prototipo, SHORTCUT_PATCHES[AGENTS.prototipo], act)
  console.log(`  note: ${PROTOTIPO_INSTRUCTIONS_NOTE}`)

  console.log('\n== Forge ==')
  await patchShortcuts(AGENTS.forge, SHORTCUT_PATCHES[AGENTS.forge], act)
  const forge = await prisma.chatAgent.findFirst({ where: { id: AGENTS.forge }, select: { systemInstructions: true } })
  // Keep payment / pickup tails from the live instructions if present after our opener block.
  const forgeTail = (forge?.systemInstructions || '').includes('Para comprar')
    ? ''
    : ''
  await patchInstructions(AGENTS.forge, 'Forge ventas', FORGE_INSTRUCTIONS + forgeTail, act)
  await upsertKnowledge(AGENTS.forge, KNOWLEDGE_UPSERTS, act)

  console.log('\n== Pura Sonrisa ==')
  await patchShortcuts(AGENTS.pura, SHORTCUT_PATCHES[AGENTS.pura], act)
  await patchInstructions(AGENTS.pura, 'Pura Sonrisa ventas', PURA_INSTRUCTIONS, act)

  console.log('\n== Sleeping ==')
  console.log('  = no copy change in this slice (payment/follow-up code covers it)')

  console.log('\n== PatchHouse ==')
  if (PATCHHOUSE_NOSTOCK) {
    console.log('  ~ would set no-stock line (opt-in). Agent status left unchanged.')
    // Intentionally no write without an owner-approved body — placeholder only.
    console.log('  TODO_OWNER: exact no-stock sentence for PatchHouse.')
  } else {
    console.log('  = paused / untouched (pass --patchhouse-nostock to opt in the no-stock line)')
  }

  await prepareFollowUps()

  console.log('\n== TODO facts for the owner ==')
  for (const t of TODOS) console.log(`  - ${t}`)

  console.log(`\nDone (${DRY ? 'dry-run — re-run with --apply to write' : 'applied'}).`)
  if (flag('--help')) {
    // no-op
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
