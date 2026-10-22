/**
 * Build (or update) a business's inbox sales agent from its pack, through the same admin functions the UI uses
 * (validation, version bump, audit). Dry run by default: prints the pre-checks and what would change.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/build-agent.ts --pack=<carpeta del pack> [--apply] [--replace-binding] [--allow-live=<agentId>] [--confirm-payment]
 *
 * SAFETY: it never activates anything (status stays draft, no flags / allowlist / unlock / caps), never writes
 * InventoryItem or ShippingMethod (shared with /ventas), never runs SQL. It refuses to touch a live agent, a channel
 * served by another agent (unless --replace-binding), a channel with an AI unlock, or knowledge another agent uses.
 * Writes go to the database DATABASE_URL points to (production for this repo's .env.local).
 *
 * --allow-live=<agentId> (2026-10-17, Rafael: the corrected PatchHouse facts never reached the live agent because of
 * the refusal above): updates a LIVE agent in place — instructions, brand facts, saved replies, knowledge, products and
 * selling script only. The id must be exactly the live agent's. It never writes the model, a channel binding, status,
 * operation mode, unlock or saved tests (any of those = BLOCKS), so the line stays on. Pausing instead would leave
 * the messages that arrive meanwhile unanswered for good (INT-98). The dry run prints every change first; the replaced
 * knowledge ids are printed for rollback (bind them again).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isChatAgentSchemaReady } from '@/lib/soft-ai/agent-schema'
import { createChatAgent, updateChatAgent, setAgentBinding } from '@/lib/soft-ai/agent-admin'
import { listShortcuts, createShortcut, updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { agentAssetsReady, storeAgentAsset, setReplyAssets, loadReplyAssets } from '@/lib/soft-ai/agent-assets'
import { createKnowledgeSource, approveKnowledgeSource, bindKnowledgeToAgent, unbindKnowledgeFromAgent } from '@/lib/soft-ai/knowledge-admin'
import { hashKnowledgeBody } from '@/lib/soft-ai/knowledge-repository'
import { KNOWLEDGE_LAYER2_CHAR_BUDGET, KNOWLEDGE_LAYER34_CHAR_BUDGET } from '@/lib/soft-ai/knowledge-types'
import { loadMappedInventoryIds, setMappedInventory } from '@/lib/soft-ai/agent-inventory-map'
import { loadSalesSetup, saveSalesSetup, parseSalesRules, salesRulesOctets, SALES_RULES_MAX_OCTETS } from '@/lib/soft-ai/agent-sales-setup'
import { parseBrandFacts, parseBrandFactsSafe, parseReplyStyleSafe, ReplyStyleSchema } from '@/lib/soft-ai/brand-facts'
import { listTestCases, createTestCase, cleanSavedTest } from '@/lib/soft-ai/probar-test-cases'
import { parseSavedTest } from '@/lib/soft-ai/probar-scenarios'
import { isTableReady, isColumnReady } from '@/lib/soft-ai/table-ready'
import { isChatStorageConfigured } from '@/lib/chat-storage'
import { loadOrderRequirements } from '@/lib/orders/order-requirements-server'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { loadDailyTestTokens } from '@/lib/soft-ai/agent-claim-gates'
import { agentsServingUnboundChannels } from '@/lib/soft-ai/agent-settings'
import { resultsClaimIn } from '@/lib/soft-ai/llm/output-validator'
import { arg, flag, loadPack, type AgentPack } from './pack'

const APPLY = flag('apply')
/** --allow-live=<agentId>: the only way to touch a live agent (exact id). */
const ALLOW_LIVE_ID = (arg('allow-live') || '').trim()
const blockers: string[] = []
const warnings: string[] = []
const log = (s: string) => console.log(s)
/** Order-insensitive for object keys (jsonb re-sorts them), order-sensitive for arrays. */
const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))

/**
 * What the engine would drop WITHOUT a warning: parseSalesRules cuts each text field at its cap (voice 600, closing 800,
 * objections 1 200…) and list items at 200 / 10 items; the prompt leaves out a whole knowledge doc when brand_book +
 * policy pass 4 000 chars or faq passes 3 000. Lane C 2026-10-22: Forge/Pura Sonrisa objections lost half their rules.
 */
export function packLimitProblems(pack: Pick<AgentPack, 'salesRules' | 'knowledge'>, rules: ReturnType<typeof parseSalesRules>): string[] {
  const problems: string[] = []
  const raw = pack.salesRules as Record<string, unknown>
  for (const key of ['voice', 'closing', 'upsells', 'objections', 'handoffWhen'] as const) {
    const wanted = typeof raw[key] === 'string' ? (raw[key] as string).trim() : ''
    const kept = (rules[key] as string | null) ?? ''
    if (wanted.length > kept.length) problems.push(`salesRules.${key}: ${wanted.length} caracteres, el motor solo guarda ${kept.length} (se cortaría: "${wanted.slice(kept.length, kept.length + 60)}…")`)
  }
  for (const key of ['mustSay', 'neverSay'] as const) {
    const items = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []
    if (items.length > rules[key].length || items.some((x, i) => typeof x === 'string' && x.trim() !== rules[key][i])) problems.push(`salesRules.${key}: máx. 10 frases de 200 caracteres (alguna se cortaría)`)
  }
  const size = (kinds: string[]) => pack.knowledge.filter((k) => kinds.includes(k.kind)).reduce((n, k) => n + k.body.length, 0)
  const layer2 = size(['brand_book', 'policy'])
  if (layer2 > KNOWLEDGE_LAYER2_CHAR_BUDGET) problems.push(`conocimiento producto + políticas: ${layer2} de ${KNOWLEDGE_LAYER2_CHAR_BUDGET} caracteres (un documento quedaría fuera del prompt)`)
  const layer34 = size(['faq'])
  if (layer34 > KNOWLEDGE_LAYER34_CHAR_BUDGET) problems.push(`conocimiento preguntas frecuentes: ${layer34} de ${KNOWLEDGE_LAYER34_CHAR_BUDGET} caracteres (un documento quedaría fuera del prompt)`)
  return problems
}

async function main() {
  const packDir = arg('pack')
  if (!packDir) throw new Error('Falta --pack=<carpeta del pack>')
  const { pack, dir } = loadPack(packDir)
  const tenantId = pack.target.tenantId
  log(`Pack: ${pack.agent.name} → tenant ${tenantId} (${APPLY ? 'APLICAR' : 'solo revisar'})`)

  // ---- Who acts (real user, honest audit name)
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true, name: true } })
  const member = user ? await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } }) : null
  if (!user || !member) blockers.push(`${pack.target.actorEmail} no es miembro activo del negocio`)
  if (member && !['OWNER', 'ADMIN'].includes(String(member.role))) blockers.push('El usuario debe ser OWNER o ADMIN')
  const actor = { actorUserId: user?.id ?? '', actorName: `${user?.name || 'Owner'} (agent-pack script)`, actorRole: String(member?.role ?? '') }

  // ---- Tables / storage
  if (!(await isChatAgentSchemaReady(true))) blockers.push('Tablas de agentes no listas')
  if (!(await agentAssetsReady())) blockers.push('Tablas de imágenes de respuestas no listas (SQL 029/053)')
  if (!(await isTableReady('ChatAgentInventoryItem'))) blockers.push('Tabla ChatAgentInventoryItem no lista (SQL 046)')
  if (!(await isColumnReady('ChatAgentSettings', 'salesRules'))) blockers.push('Columna ChatAgentSettings.salesRules no lista (SQL 053)')
  if (!(await isTableReady('ChatAgentTestCase'))) warnings.push('Tabla de pruebas guardadas no lista: no se guardan pruebas')
  if (pack.shortcuts.some((s) => s.images?.length) && !isChatStorageConfigured()) blockers.push('Almacenamiento de imágenes no configurado')

  // ---- Existing agent
  const existing = await prisma.chatAgent.findFirst({ where: { tenantId, name: pack.agent.name.trim() } })
  if (existing?.status === 'archived') blockers.push(`"${existing.name}" está archivado: restauralo o cambiá el nombre en el pack`)
  const liveMode = existing?.status === 'live' && ALLOW_LIVE_ID === existing.id
  if (existing?.status === 'live' && !liveMode) {
    blockers.push(
      ALLOW_LIVE_ID
        ? `--allow-live=${ALLOW_LIVE_ID} no es el id de "${existing.name}" (${existing.id})`
        : `"${existing.name}" está activo: este script no modifica agentes activos (usá --allow-live=${existing.id})`,
    )
  }
  if (ALLOW_LIVE_ID && !liveMode && existing?.status !== 'live') blockers.push('--allow-live solo sirve para un agente activo')
  // SecureDog: a live agent never loses its product list (the app refuses an empty list too).
  if (liveMode && !pack.inventory.names.length) blockers.push('Modo activo: el pack no trae productos; un agente activo no puede quedar sin productos')
  // SecureDog: payment details (SINPE / cuenta / tarjeta) change what customers pay to — shown and confirmed on purpose.
  if (liveMode && existing) {
    // Compared by content (jsonb re-sorts keys), shown sorted.
    const payNow = JSON.stringify(stable((existing.brandFacts as { payment?: unknown } | null)?.payment ?? null))
    const payPack = JSON.stringify(stable((pack.brandFacts as { payment?: unknown } | null)?.payment ?? null))
    if (payNow !== payPack) {
      const mask = (j: string) => j.replace(/\d[\d\s.-]{3,}\d/g, (m) => '••••' + m.replace(/\D/g, '').slice(-4))
      log(`  CAMBIAN LOS DATOS DE PAGO:\n    antes: ${mask(payNow)}\n    pack:  ${mask(payPack)}`)
      if (!flag('confirm-payment')) blockers.push('Modo activo: los datos de pago cambian — revisalos arriba y agregá --confirm-payment')
    }
  }
  if (liveMode && pack.agent.model && pack.agent.model !== existing!.model) {
    blockers.push(`Modo activo: el pack cambia el modelo (${existing!.model} → ${pack.agent.model}); eso apaga la línea hasta Activar. Cambialo desde la app.`)
  }
  log(existing ? `Agente existente ${existing.id} (v${existing.version}, ${existing.status}${liveMode ? ', MODO ACTIVO' : ''})` : 'Agente nuevo')

  // ---- No results / health promise anywhere the agent reads or copies (2026-10-17: ph_resultados said
  // "muchas personas … notan cambios en los primeros días" and the live agent repeated it).
  const packTexts: Array<[string, string]> = [
    ['instrucciones', pack.agent.systemInstructions],
    ...pack.knowledge.map((k): [string, string] => [`conocimiento "${k.name}"`, k.body]),
    ...pack.shortcuts.map((s): [string, string] => [`respuesta ${s.key}`, s.body]),
    ...Object.entries(pack.systemReplies ?? {}).map(([k, v]): [string, string] => [`respuesta del sistema ${k}`, v]),
    // SecureDog: the brand facts and the selling script reach the prompt too.
    ['datos de la marca', JSON.stringify(pack.brandFacts ?? {})],
    // The never-say list holds the forbidden phrases themselves ("no decir: muchas personas notan cambios").
    ['guion de venta', JSON.stringify({ ...(pack.salesRules ?? {}), neverSay: undefined })],
  ]
  for (const [where, text] of packTexts) {
    // Line by line (a precise message) and the whole text (a promise split over two lines).
    // "Nunca prometas…" is allowed in instructions / knowledge only; saved replies go to customers word for word.
    const opts = { instructions: /^(?:instrucciones|conocimiento)/.test(where) }
    const claim = String(text || '').split('\n').map((line) => resultsClaimIn(line, opts)).find(Boolean) ?? resultsClaimIn(String(text || '').replace(/\s+/g, ' '), opts)
    if (claim) blockers.push(`${where} promete resultados ("${claim}"): usá solo ingredientes y modo de uso`)
  }

  // ---- Brand facts + sales rules validate locally first
  let brandFacts: ReturnType<typeof parseBrandFacts> | null = null
  try {
    brandFacts = parseBrandFacts(pack.brandFacts)
  } catch (e) {
    blockers.push(`brandFacts inválidos: ${(e as Error).message.slice(0, 300)}`)
  }
  const rules = parseSalesRules(pack.salesRules)
  if (salesRulesOctets(rules) > SALES_RULES_MAX_OCTETS) blockers.push('salesRules demasiado grandes (> 8 000 bytes)')
  if ((rules.bundles?.length ?? 0) !== ((pack.salesRules.bundles as unknown[]) ?? []).length) warnings.push('Algún combo fue descartado (nombre o precio inválido)')
  for (const problem of packLimitProblems(pack, rules)) blockers.push(problem)

  // ---- Products: read only (shared with /ventas)
  const itemIds: string[] = []
  for (const name of pack.inventory.names) {
    const rows = await prisma.inventoryItem.findMany({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, sellingPrice: true, currentStock: true, isActive: true },
    })
    const active = rows.filter((r) => r.isActive)
    if (active.length !== 1) {
      blockers.push(`Producto "${name}": ${active.length} activos con ese nombre (debe ser 1)`)
      continue
    }
    const r = active[0]
    itemIds.push(r.id)
    log(`  producto ${r.name}: ₡${Number(r.sellingPrice)} · stock ${r.currentStock}`)
    if (r.currentStock <= 0) warnings.push(`"${r.name}" sin stock: el agente lo dirá agotado`)
  }

  // ---- Shipping + order fields (read only)
  const methodCount = await prisma.shippingMethod.count({ where: { tenantId, active: true } })
  if (methodCount > 0) warnings.push(`El negocio tiene ${methodCount} métodos de envío: el agente usará esos, no los del pack`)
  const req = await loadOrderRequirements(tenantId).catch(() => null)
  const extraFields = [...(req?.customerFields ?? []), ...(req?.productFields ?? [])].map((f) => f.label)
  log(`  datos extra que pide /ventas: ${extraFields.length ? extraFields.join(', ') : '(ninguno)'}`)

  // ---- Channels: never take one over silently
  const layer = parseChatAgentLayerConfig((await readChatAgentLayerConfig(tenantId)).config)
  const unbound = await agentsServingUnboundChannels(tenantId).catch(() => new Set<string>())
  const tenantDefault = await prisma.chatAgentBinding.findFirst({ where: { tenantId, scope: 'tenant_default', isActive: true }, select: { agentId: true } })
  const bindPlan: string[] = []
  for (const accountId of pack.target.socialAccountIds) {
    const acc = await prisma.socialAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true, platform: true, displayName: true } })
    if (!acc) {
      blockers.push(`Canal ${accountId} no es de este negocio`)
      continue
    }
    const current = await prisma.chatAgentBinding.findFirst({
      where: { tenantId, socialAccountId: accountId, scope: 'social_account', isActive: true },
      select: { agentId: true },
    })
    // Live mode: this agent's own activated channel is expected (it is what stays on); any other channel still blocks.
    const ownLiveChannel = liveMode && current?.agentId === existing?.id
    if (layer.aiFullUnlock[accountId] && !ownLiveChannel) blockers.push(`El canal ${acc.displayName} tiene la IA activada: no se toca`)
    if (liveMode && !ownLiveChannel) blockers.push(`Modo activo: el canal ${acc.displayName} no está atado a este agente; atar canales se hace desde la app`)
    if (current && current.agentId !== existing?.id) {
      if (flag('replace-binding')) warnings.push(`El canal ${acc.displayName} deja de usar el agente ${current.agentId}`)
      else blockers.push(`El canal ${acc.displayName} ya está atado a otro agente (${current.agentId}); usa --replace-binding si es a propósito`)
    }
    if (!current || current.agentId !== existing?.id) bindPlan.push(accountId)
    log(`  canal ${acc.platform} ${acc.displayName}: ${current ? (current.agentId === existing?.id ? 'ya atado a este agente' : 'atado a otro agente') : 'sin agente'}`)
  }

  if (bindPlan.length && tenantDefault && unbound.has(tenantDefault.agentId)) {
    blockers.push('El agente predeterminado atiende canales sin agente: atar este canal a un borrador lo dejaría sin respuesta')
  }

  // ---- Knowledge names are tenant-wide: never archive another agent's document
  for (const k of pack.knowledge) {
    const sources = await prisma.chatKnowledgeSource.findMany({ where: { tenantId, kind: k.kind, name: k.name, status: 'approved' }, select: { id: true } })
    if (!sources.length) continue
    const links = await prisma.chatAgentKnowledgeSource.findMany({ where: { tenantId, sourceId: { in: sources.map((s) => s.id) } }, select: { agentId: true } })
    if (links.some((l) => l.agentId !== existing?.id)) blockers.push(`Otro agente usa el documento "${k.name}": cambiá el nombre en el pack`)
  }

  // ---- Test budget (shared by the business)
  const used = await loadDailyTestTokens(tenantId).catch(() => 0)
  log(`  pruebas hoy: ${used.toLocaleString('es-CR')} de ${layer.testDailyTokenCap.toLocaleString('es-CR')} tokens`)

  // ---- Live mode: print exactly what would change (read only), before any write
  if (liveMode && existing && brandFacts) {
    const storedNow: Record<string, unknown> = { ...existing, brandFacts: parseBrandFactsSafe(existing.brandFacts), replyStyle: parseReplyStyleSafe(existing.replyStyle) }
    const wantedNow: Record<string, unknown> = {
      emoji: pack.agent.emoji,
      description: pack.agent.description ?? null,
      systemInstructions: pack.agent.systemInstructions.trim(),
      tonePreset: pack.agent.tonePreset,
      introductionNames: pack.agent.introductionNames ?? [],
      brandFacts,
      replyStyle: pack.agent.replyStyle ? ReplyStyleSchema.parse(pack.agent.replyStyle) : undefined,
    }
    const fields = Object.entries(wantedNow).filter(([k, v]) => v !== undefined && !same(storedNow[k], v)).map(([k]) => k)
    log(`  CAMBIA en el agente: ${fields.length ? fields.join(', ') : '(nada)'}`)
    const boundNow = new Set((await prisma.chatAgentKnowledgeSource.findMany({ where: { tenantId, agentId: existing.id }, select: { sourceId: true } })).map((r) => r.sourceId))
    for (const k of pack.knowledge) {
      const cur = await prisma.chatKnowledgeSource.findMany({ where: { tenantId, kind: k.kind, name: k.name, status: 'approved' }, select: { id: true, contentHash: true } })
      if (cur.some((c) => c.contentHash === hashKnowledgeBody(k.body.trim()) && boundNow.has(c.id))) continue
      const old = cur.filter((c) => boundNow.has(c.id)).map((c) => c.id)
      log(`  CAMBIA conocimiento "${k.name}" (reemplaza: ${old.length ? old.join(', ') : 'ninguno'})`)
    }
    const shortcutsNow = new Map((await listShortcuts(tenantId, existing.id)).shortcuts.map((s) => [s.key, s]))
    const newKeys = pack.shortcuts.filter((s) => !shortcutsNow.has(s.key)).map((s) => s.key)
    const changedKeys = pack.shortcuts
      .filter((s) => {
        const row = shortcutsNow.get(s.key)
        return row && !same([row.title, row.intents, row.keywords, row.body, row.deliveryMode, row.isActive], [s.title, s.intents ?? [], s.keywords ?? [], s.body, s.deliveryMode ?? 'guide', true])
      })
      .map((s) => s.key)
    log(`  respuestas guardadas: ${newKeys.length} nuevas${newKeys.length ? ` (${newKeys.join(', ')})` : ''}, ${changedKeys.length} cambiadas${changedKeys.length ? ` (${changedKeys.join(', ')})` : ''}`)
    log('  NO toca: modelo, canal, estado, modo, activación, pruebas guardadas')
  }

  for (const w of warnings) log(`AVISO: ${w}`)
  if (blockers.length) {
    for (const b of blockers) log(`BLOQUEA: ${b}`)
    process.exitCode = 1
    return
  }
  if (!APPLY) {
    log('Revisión OK. Nada se escribió. Para crear/actualizar: agregá --apply')
    return
  }

  // ================= APPLY =================
  const agentPatch = {
    emoji: pack.agent.emoji,
    description: pack.agent.description ?? null,
    systemInstructions: pack.agent.systemInstructions.trim(),
    tonePreset: pack.agent.tonePreset,
    introductionNames: pack.agent.introductionNames ?? [],
    // Live mode never writes the model (the unlock is per agent + model: a change silences the line).
    model: liveMode ? undefined : pack.agent.model,
    brandFacts,
    replyStyle: pack.agent.replyStyle ? ReplyStyleSchema.parse(pack.agent.replyStyle) : undefined,
  }
  let agentId = existing?.id
  if (!agentId) {
    const created = await createChatAgent({
      tenantId,
      ...actor,
      name: pack.agent.name,
      emoji: pack.agent.emoji,
      description: pack.agent.description,
      systemInstructions: pack.agent.systemInstructions,
      tonePreset: pack.agent.tonePreset,
      introductionNames: pack.agent.introductionNames,
    })
    agentId = created.id
    log(`✔ agente creado ${agentId}`)
  }
  const now = await prisma.chatAgent.findFirstOrThrow({ where: { id: agentId, tenantId } })
  // Compare what is stored the way it is read back (parsed, defaults filled), so an unchanged pack changes nothing.
  const stored: Record<string, unknown> = { ...now, brandFacts: parseBrandFactsSafe(now.brandFacts), replyStyle: parseReplyStyleSafe(now.replyStyle) }
  const changed = Object.entries(agentPatch).filter(([k, v]) => v !== undefined && !same(stored[k], v))
  if (changed.length) {
    await updateChatAgent({ tenantId, agentId, ...actor, patch: Object.fromEntries(changed) })
    log(`✔ agente: ${changed.map(([k]) => k).join(', ')}`)
  }

  // Saved replies (system wording + the business's own) and their images
  const listed = await listShortcuts(tenantId, agentId)
  const byKey = new Map(listed.shortcuts.map((s) => [s.key, s]))
  for (const [key, body] of Object.entries(pack.systemReplies ?? {})) {
    const row = byKey.get(key)
    if (row && row.body !== body) {
      await updateShortcut({ tenantId, agentId, shortcutId: row.id, ...actor, patch: { body } })
      log(`✔ respuesta del sistema ${key}`)
    }
  }
  const assetCache = new Map<string, string>()
  const replyAssets = await loadReplyAssets(tenantId, agentId)
  let sort = 10
  for (const s of pack.shortcuts) {
    const draft = {
      key: s.key,
      title: s.title,
      kind: 'playbook' as const,
      intents: s.intents ?? [],
      keywords: s.keywords ?? [],
      body: s.body,
      deliveryMode: s.deliveryMode ?? 'guide',
      isActive: true,
      sortOrder: (sort += 10),
    }
    const row = byKey.get(s.key)
    let id = row?.id
    if (!row) {
      id = (await createShortcut({ tenantId, agentId, ...actor, draft })).id
      log(`✔ respuesta ${s.key}`)
    } else if (!same([row.title, row.intents, row.keywords, row.body, row.deliveryMode, row.isActive], [draft.title, draft.intents, draft.keywords, draft.body, draft.deliveryMode, true])) {
      await updateShortcut({ tenantId, agentId, shortcutId: row.id, ...actor, patch: draft })
      log(`✔ respuesta ${s.key} (actualizada)`)
    }
    const wanted: string[] = []
    for (const file of s.images ?? []) {
      if (!assetCache.has(file)) {
        const bytes = readFileSync(join(dir, 'images', file))
        const asset = await storeAgentAsset({ tenantId, agentId, bytes, name: file, caption: s.title, userId: actor.actorUserId })
        assetCache.set(file, asset.id)
      }
      wanted.push(assetCache.get(file)!)
    }
    const have = (replyAssets.get(id!) ?? []).map((a) => a.id)
    if (!same(have, wanted)) {
      await setReplyAssets({ tenantId, agentId, shortcutId: id!, assetIds: wanted })
      log(`✔ imágenes de ${s.key}: ${wanted.length}`)
    }
  }

  // Knowledge: unchanged → nothing; changed → new approved version bound, old one unbound
  const boundRows = await prisma.chatAgentKnowledgeSource.findMany({ where: { tenantId, agentId }, select: { sourceId: true } })
  const bound = new Set(boundRows.map((r) => r.sourceId))
  for (const k of pack.knowledge) {
    const current = await prisma.chatKnowledgeSource.findMany({ where: { tenantId, kind: k.kind, name: k.name, status: 'approved' }, select: { id: true, contentHash: true } })
    if (current.some((c) => c.contentHash === hashKnowledgeBody(k.body.trim()) && bound.has(c.id))) continue
    const created = await createKnowledgeSource({ tenantId, ...actor, kind: k.kind, name: k.name, body: k.body, metadata: { agentPack: true } })
    await approveKnowledgeSource({ tenantId, sourceId: created.id, ...actor })
    await bindKnowledgeToAgent({ tenantId, agentId, sourceId: created.id, ...actor })
    const replaced = current.filter((old) => bound.has(old.id)).map((old) => old.id)
    for (const id of replaced) await unbindKnowledgeFromAgent({ tenantId, agentId, sourceId: id, ...actor })
    log(`✔ conocimiento "${k.name}"${replaced.length ? ` (antes: ${replaced.join(', ')} — volver a atarlos para deshacer)` : ''}`)
  }

  // Products the agent may sell (exactly the pack's list)
  const mapped = (await loadMappedInventoryIds(tenantId, agentId)) ?? []
  if (!same([...mapped].sort(), [...itemIds].sort())) {
    await setMappedInventory({ tenantId, agentId, itemIds, actorUserId: actor.actorUserId })
    log(`✔ productos: ${itemIds.length}`)
  }

  // Selling script + combos
  const setup = await loadSalesSetup(tenantId, agentId)
  // The owner's promo and "¿sos un bot?" choice (UI) stay unless the pack sets them.
  const wantedRules = {
    ...rules,
    promo: setup.salesRules.promo,
    aiDisclosure: pack.salesRules.aiDisclosure ? rules.aiDisclosure : setup.salesRules.aiDisclosure,
  }
  if (!same(setup.salesRules, wantedRules)) {
    await saveSalesSetup(tenantId, agentId, { salesRules: wantedRules }, actor.actorUserId)
    log('✔ guion de venta y combos')
  }

  // Channel binding (test chat needs it; a draft never answers customers)
  for (const accountId of bindPlan) {
    await setAgentBinding({ tenantId, agentId, socialAccountId: accountId, active: true, ...actor })
    log(`✔ atado al canal ${accountId}`)
  }

  // Saved tests (the test chat keeps plain-phrase checks; the full checks run in probar.ts). Live mode leaves them:
  // they are the activation suite of a line that is on.
  const cases = liveMode ? null : await listTestCases(tenantId, agentId)
  if (cases?.available) {
    const titles = new Set(cases.cases.map((c) => c.title))
    let added = 0
    for (const t of pack.tests) {
      // Titles are stored masked (cleanSavedTest): compare the way they are stored.
      if (titles.has(t.title) || titles.has(cleanSavedTest({ title: t.title, steps: [] }).title)) continue
      const parsed = parseSavedTest(t)
      if (!parsed.ok) {
        log(`  prueba "${t.title}" omitida: ${parsed.error}`)
        continue
      }
      try {
        await createTestCase({ tenantId, agentId, userId: actor.actorUserId, test: parsed.value })
        added += 1
      } catch (e) {
        log(`  pruebas: ${(e as Error).message} (se guardaron ${added})`)
        break
      }
    }
    if (added) log(`✔ pruebas guardadas: ${added}`)
  }

  const final = await prisma.chatAgent.findFirstOrThrow({ where: { id: agentId, tenantId }, select: { id: true, version: true, status: true, operationMode: true } })
  log(`Listo: ${final.id} · v${final.version} · ${final.status} · ${final.operationMode}`)
  log(`Huella del pack: ${createHash('sha256').update(JSON.stringify(pack)).digest('hex').slice(0, 12)}`)
}

if (process.argv[1]?.endsWith('build-agent.ts')) {
  main()
    .catch((e) => {
      console.error(`ERROR: ${(e as Error).message}`)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
