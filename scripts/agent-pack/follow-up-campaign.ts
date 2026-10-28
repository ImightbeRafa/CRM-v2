/**
 * Follow-up A/B campaign (follow-up.ts): create / start / rotate / stop / report — audited, OWNER/ADMIN actor from the pack.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/agent-pack/follow-up-campaign.ts …
 *
 *   Standing experiment (pack's follow-up.json: champion text vs the next challenger, winner rule in follow-up-rule.ts):
 *   … --pack=../betsy-agent-packs/patchhouse --start   [--dry-run]   first round (refuses an agent that is not live)
 *   … --pack=../betsy-agent-packs/patchhouse --rotate  [--dry-run]   apply the winner rule, then open the next round
 *   … --compare --root=../betsy-agent-packs                          every agent's experiment side by side (read-only)
 *
 *   By hand:
 *   … --pack=… --agent=<id> --lines=<id,id> --create --a="texto A" --b="texto B" [--keys=a,b] [--hours=18] [--silent-min=90] [--dry-run]
 *   … --pack=… --stop [--id=<campaignId>] [--agent=<id>] [--dry-run]
 *   … --pack=… --report [--id=<campaignId>] [--replies]               (read-only)
 *   … --pack=… --eligible                                             who could get one now, per line, and why not (read-only)
 *
 * A new campaign stops only the SAME agent's earlier campaigns (one tenant hosts several store agents), and is refused
 * when another agent's running campaign uses one of its lines.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/auditLogger'
import { FOLLOW_UP_FLAG, FOLLOW_UP_WINDOW_MS, MAX_CAMPAIGN_HOURS, RENEW_MAX_AGE_MS, SILENT_MIN_MINUTES, followUpSkipReason, parseFollowUpConfig, type FollowUpCampaign, type FollowUpVariant } from '@/lib/soft-ai/follow-up'
import { isOptOutText } from '@/lib/soft-ai/waiting-ack'
import { parseStageTexts } from '@/lib/soft-ai/follow-up-state'
import { loadPack } from './pack'
import { decideWinner, WINNER_RULE, type ArmStats } from './follow-up-rule'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const flag = (name: string) => process.argv.includes(`--${name}`)
const DRY = flag('dry-run')

/** Same soft "no" as follow-up.ts DECLINE_RE (kept in sync by hand). Report column only — never feeds the winner rule:
 * it also matches buying phrases ("ya no puedo dormir, ¿cuánto cuesta?"). */
const DECLINE_RE = /(?<![\p{L}])(no\s*,?\s*gracias|no\s+me\s+interesa|no\s+por\s+ahora|m[aá]s\s+adelante|ya\s+no|despu[eé]s\s+(?:te|les)\s+(?:escribo|aviso)|lo\s+pienso)(?![\p{L}])/iu
const REPLY_WINDOW_MS = 24 * 3600_000
const ORDER_WINDOW_MS = 7 * 24 * 3600_000
const VARIANTS: FollowUpVariant[] = ['A', 'B']

/** Campaign as stored: the engine keeps unknown fields, so text keys / plan info ride along. */
type StoredCampaign = FollowUpCampaign & { keys?: Partial<Record<FollowUpVariant, string>>; stoppedAt?: string }

/** Pack's follow-up.json — the standing experiment for one agent. */
type FollowUpPlan = {
  agentId: string
  agentName: string
  /** live = may run now · draft = starts when Rafael switches the agent on · on_hold = do not start. */
  status: 'live' | 'draft' | 'on_hold'
  lineIds: string[]
  silentMinutes: number
  roundHours: number
  champion: string
  /** Order to try challengers in (first one not retired and not the champion is the current challenger). */
  challengers: string[]
  texts: Record<string, string>
  /** key → why it left the race (written by --rotate). */
  retired?: Record<string, string>
  /** Earlier campaigns without stored keys: campaignId → { A: key, B: key }. */
  legacy?: Record<string, Partial<Record<FollowUpVariant, string>>>
  notes?: string[]
  /** Follow-ups v2: text key → slot texts (chose / quoted / sinpe_reminder) used when that key runs in a round. */
  stageTexts?: Record<string, unknown>
}

function loadPlan(packDir: string): { plan: FollowUpPlan; file: string } {
  const file = join(resolve(packDir), 'follow-up.json')
  if (!existsSync(file)) throw new Error(`falta ${file}`)
  const plan = JSON.parse(readFileSync(file, 'utf8')) as FollowUpPlan
  if (!plan.agentId || !Array.isArray(plan.lineIds) || !plan.texts || !plan.texts[plan.champion]) throw new Error(`${file}: agentId, lineIds y el texto del campeón son obligatorios`)
  for (const [k, t] of Object.entries(plan.texts)) if (!t.trim() || t.length > 500) throw new Error(`${file}: el texto "${k}" debe tener 1–500 caracteres`)
  return { plan, file }
}

function currentChallenger(plan: FollowUpPlan): string | null {
  return plan.challengers.find((k) => k !== plan.champion && !plan.retired?.[k] && plan.texts[k]) ?? null
}

function keyOf(c: StoredCampaign, v: FollowUpVariant, plan?: FollowUpPlan): string {
  const stored = c.keys?.[v] ?? plan?.legacy?.[c.id]?.[v]
  if (stored) return stored
  const byText = plan && Object.entries(plan.texts).find(([, t]) => t.trim() === c.texts[v].trim())?.[0]
  return byText ?? `${c.id}:${v}`
}

/** `reminders`: SINPE reminders (follow-ups v2) — only the arm with a reminder text reaches those chats, so they never count toward the winner rule. */
type VariantStats = { sent: number; failed: number; replied: number; ordered: number; revenue: number; optedOut: number; softNo: number; reminders: number; byLine: Record<string, number>; replies: string[] }
const emptyStats = (): VariantStats => ({ sent: 0, failed: 0, replied: 0, ordered: 0, revenue: 0, optedOut: 0, softNo: 0, reminders: 0, byLine: {}, replies: [] })

/** Read-only: what each variant of one campaign did. Reply = customer wrote within 24 h; order = linked within 7 days. */
async function campaignStats(tenantId: string, c: StoredCampaign): Promise<Record<FollowUpVariant, VariantStats>> {
  const stats: Record<FollowUpVariant, VariantStats> = { A: emptyStats(), B: emptyStats() }
  for (const [convId, raw] of Object.entries(c.claimed)) {
    const variant = String(raw).replace('!', '') as FollowUpVariant
    const s = stats[variant]
    if (!s) continue
    const fu = await prisma.chatMessage.findFirst({
      where: { tenantId, conversationId: convId, direction: 'outbound', metadata: { path: ['followUp', 'campaignId'], equals: c.id } },
      select: { sentAt: true, socialAccountId: true, metadata: true },
    })
    // Claimed but never stored as sent (or marked failed): not counted as sent (keeps the rates honest).
    if (String(raw).endsWith('!') || !fu) {
      s.failed++
      continue
    }
    // Verifier 2026-10-28: a SINPE reminder reached a chat the other arm never nudges (it was close to paying) → apart.
    if ((fu.metadata as { followUp?: { slot?: unknown } } | null)?.followUp?.slot === 'sinpe_reminder') {
      s.reminders++
      continue
    }
    s.sent++
    s.byLine[fu.socialAccountId] = (s.byLine[fu.socialAccountId] ?? 0) + 1
    const after = await prisma.chatMessage.findMany({
      where: { tenantId, conversationId: convId, direction: 'inbound', sentAt: { gt: fu.sentAt, lte: new Date(fu.sentAt.getTime() + REPLY_WINDOW_MS) } },
      orderBy: { sentAt: 'asc' },
      take: 5,
      select: { content: true },
    })
    if (after.length) {
      s.replied++
      s.replies.push(after.map((m) => (m.content || '').replace(/\s+/g, ' ').slice(0, 70)).join(' | '))
    }
    // Opt-out (guardrail) = a hard "stop writing me"; a soft "no gracias / más adelante" is reported apart.
    if (after.some((m) => isOptOutText(m.content))) s.optedOut++
    else if (after.some((m) => DECLINE_RE.test(m.content || ''))) s.softNo++
    // Chats with an order were never followed up, so a linked order after the send came after the follow-up.
    const linked = await prisma.chatMessage.findMany({ where: { tenantId, conversationId: convId, orderId: { not: null } }, select: { orderId: true } })
    const orderIds = [...new Set(linked.map((m) => m.orderId!))]
    if (orderIds.length) {
      const orders = await prisma.order.findMany({
        where: { tenantId, id: { in: orderIds }, deletedAt: null, timestamp: { gte: fu.sentAt, lte: new Date(fu.sentAt.getTime() + ORDER_WINDOW_MS) } },
        select: { total: true, status: true },
      })
      const real = orders.filter((o) => !/cancel|anulad/i.test(o.status))
      if (real.length) {
        s.ordered++
        s.revenue += real.reduce((sum, o) => sum + (o.total || 0), 0)
      }
    }
  }
  return stats
}

type RawCampaign = Record<string, unknown>
/**
 * Changes the STORED campaigns array under a row lock (SELECT … FOR UPDATE): the cron's claim UPDATE waits and then
 * re-checks its id-at-index guard, so no claim is lost and two script runs can't overwrite each other. Works on the raw
 * array (malformed entries and their claims are kept as they are); only appends or edits by id, so indexes never move.
 */
async function mutateCampaigns(flagId: string, change: (raw: RawCampaign[]) => RawCampaign[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT "config" FROM "TenantFeatureFlag" WHERE "id" = ${flagId} AND "key" = ${FOLLOW_UP_FLAG} FOR UPDATE`
    if (rows.length !== 1) throw new Error('flag de seguimientos no encontrado')
    const config = (rows[0].config && typeof rows[0].config === 'object' ? rows[0].config : {}) as Record<string, unknown>
    const raw = Array.isArray(config.campaigns) ? (config.campaigns as RawCampaign[]) : []
    await tx.tenantFeatureFlag.update({ where: { id: flagId }, data: { config: { ...config, campaigns: change(raw) } as object } })
  })
}
/** Stops the matching campaigns (raw entries, by id / agent) and records when. */
const stopWhere = (hit: (c: RawCampaign) => boolean) => (raw: RawCampaign[]) =>
  raw.map((c) => (c && typeof c === 'object' && c.active === true && hit(c) ? { ...c, active: false, stoppedAt: new Date().toISOString() } : c))

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–')
const crc = (n: number) => `₡${Math.round(n).toLocaleString('es-CR').replace(/,/g, ' ')}`

/** Champion vs challenger over every round where both ran together. */
async function pairStats(tenantId: string, campaigns: StoredCampaign[], plan: FollowUpPlan, keys: [string, string]): Promise<[ArmStats, ArmStats]> {
  const arms = keys.map((key) => ({ key, sent: 0, replied: 0, ordered: 0, revenue: 0, optedOut: 0, days: 0 })) as [ArmStats, ArmStats]
  // Time the rounds really ran (gaps between rounds don't count toward the 7 days).
  let ranMs = 0
  for (const c of campaigns) {
    const inRound = VARIANTS.map((v) => keyOf(c, v, plan))
    if (!keys.every((k) => inRound.includes(k))) continue
    const st = await campaignStats(tenantId, c)
    for (const v of VARIANTS) {
      const arm = arms.find((a) => a.key === keyOf(c, v, plan))!
      arm.sent += st[v].sent
      arm.replied += st[v].replied
      arm.ordered += st[v].ordered
      arm.revenue += st[v].revenue
      arm.optedOut += st[v].optedOut
    }
    const end = Math.min(Date.now(), Date.parse(c.until), c.stoppedAt ? Date.parse(c.stoppedAt) : Infinity)
    ranMs += Math.max(0, end - Date.parse(c.createdAt))
  }
  const days = ranMs / 86_400_000
  for (const a of arms) a.days = days
  return arms
}

function printArm(label: string, a: ArmStats) {
  console.log(
    `  ${label.padEnd(10)} ${a.key.padEnd(12)} enviados ${String(a.sent).padStart(4)} · respondieron ${pct(a.replied, a.sent).padStart(4)} (${a.replied}) · pedidos ${pct(a.ordered, a.sent).padStart(4)} (${a.ordered}) · ${crc(a.revenue)} · bajas ${a.optedOut}`,
  )
}

async function main() {
  // --compare reads every pack under --root (all agents share one tenant per pack's target).
  if (flag('compare')) {
    const root = resolve(arg('root') || '../betsy-agent-packs')
    const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'follow-up.json')))
    console.log(`Regla: mínimo ${WINNER_RULE.minPerArm} chats por texto y ${WINNER_RULE.minDays} días · gana con 95 % de seguridad en pedidos; si los pedidos no deciden, en respuestas sin vender claramente menos · bajas > 3 % = fuera\n`)
    for (const d of dirs) {
      const { pack } = loadPack(join(root, d.name))
      const { plan } = loadPlan(join(root, d.name))
      const row = await prisma.tenantFeatureFlag.findFirst({ where: { scope: pack.target.tenantId, key: FOLLOW_UP_FLAG } })
      const mine = parseFollowUpConfig(row?.config).campaigns.filter((c) => c.agentId === plan.agentId) as StoredCampaign[]
      const running = mine.find((c) => c.active && Date.parse(c.until) > Date.now())
      const agent = await prisma.chatAgent.findFirst({ where: { id: plan.agentId, tenantId: pack.target.tenantId }, select: { status: true } })
      console.log(`${plan.agentName} (${d.name}) · agente ${agent?.status ?? '¿?'} · plan ${plan.status} · ${running ? `ronda ${running.id} hasta ${running.until}` : 'sin ronda activa'}`)
      const challenger = currentChallenger(plan)
      if (!challenger) console.log('  (sin retador en la fila)')
      else {
        const [champ, chall] = await pairStats(pack.target.tenantId, mine, plan, [plan.champion, challenger])
        printArm('campeón', champ)
        printArm('retador', chall)
        const verdict = decideWinner(champ, chall)
        console.log(`  → ${verdict.kind}: ${verdict.reason}`)
      }
      for (const [k, why] of Object.entries(plan.retired ?? {})) console.log(`  retirado ${k}: ${why}`)
      console.log('')
    }
    return
  }

  const { pack, dir: packDir } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true, name: true } })
  const member = user ? await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } }) : null
  if (!user || !member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error(`${pack.target.actorEmail} debe ser OWNER o ADMIN activo`)
  const row = await prisma.tenantFeatureFlag.findFirst({ where: { scope: tenantId, key: FOLLOW_UP_FLAG } })
  const config = parseFollowUpConfig(row?.config)
  const campaigns = config.campaigns as StoredCampaign[]
  const audit = (description: string, newValues: Record<string, unknown>) =>
    logAudit({ action: 'UPDATE', entityType: 'FollowUpCampaign', entityId: tenantId, description, newValues, userId: user.id, userName: `${user.name || 'Owner'} (follow-up script)`, userRole: String(member.role), tenantId })

  /** Validates and stores a new campaign; stops only this agent's earlier campaigns. */
  async function createCampaign(input: {
    agentId: string
    lineIds: string[]
    a: string
    b: string
    keys?: [string, string]
    hours: number
    silent: number
    why: string
    /** Follow-ups v2: per-arm slot texts from follow-up.json `stageTexts[key]` (follow-up-state.ts). */
    stageTexts?: FollowUpCampaign['stageTexts']
  }) {
    const { agentId, lineIds, a, b, hours, silent } = input
    if (!agentId || !lineIds.length || !a || !b) throw new Error('--agent, --lines, --a y --b son obligatorios')
    if (a.length > 500 || b.length > 500) throw new Error('textos de máximo 500 caracteres')
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_CAMPAIGN_HOURS) throw new Error(`--hours entre 1 y ${MAX_CAMPAIGN_HOURS}`)
    if (!Number.isFinite(silent) || silent < SILENT_MIN_MINUTES || silent > 1440) throw new Error(`--silent-min entre ${SILENT_MIN_MINUTES} y 1440`)
    const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId }, select: { id: true, name: true, status: true } })
    if (!agent) throw new Error('agente no encontrado en este negocio')
    const lines = await prisma.socialAccount.count({ where: { id: { in: lineIds }, tenantId } })
    if (lines !== lineIds.length) throw new Error('alguna línea no es de este negocio')
    const clash = campaigns.find((c) => c.agentId !== agentId && c.active && Date.parse(c.until) > Date.now() && c.lineIds.some((l) => lineIds.includes(l)))
    if (clash) throw new Error(`la campaña ${clash.id} de otro agente usa una de estas líneas`)
    const bound = await prisma.chatAgentBinding.count({ where: { tenantId, agentId, socialAccountId: { in: lineIds }, isActive: true } })
    const now = Date.now()
    const campaign: StoredCampaign = {
      id: `fu-${new Date(now).toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`,
      agentId,
      lineIds,
      texts: { A: a, B: b },
      createdAt: new Date(now).toISOString(),
      until: new Date(now + hours * 3600_000).toISOString(),
      silentMinMinutes: silent,
      active: true,
      claimed: {},
      ...(input.keys ? { keys: { A: input.keys[0], B: input.keys[1] } } : {}),
      ...(input.stageTexts ? { stageTexts: input.stageTexts } : {}),
    }
    const stopped = campaigns.filter((c) => c.agentId === agentId && c.active).map((c) => c.id)
    console.log(`${DRY ? '[dry-run] crearía' : 'Crea'} ${campaign.id} · agente ${agent.name} (${agent.status}) · líneas ${lineIds.length} (${bound} con el agente activo) · espera ${silent} min · hasta ${campaign.until}`)
    console.log(`  A${input.keys ? ` (${input.keys[0]})` : ''}: "${a}"\n  B${input.keys ? ` (${input.keys[1]})` : ''}: "${b}"`)
    for (const [arm, slots] of Object.entries(input.stageTexts ?? {}))
      for (const [slot, text] of Object.entries(slots ?? {})) console.log(`    ${arm} · ${slot}: "${text}"`)
    console.log(`  detiene: ${stopped.join(', ') || '(ninguna)'} · motivo: ${input.why}`)
    if (agent.status !== 'live') console.log('  OJO: el agente no está live → el motor no envía nada hasta que Rafael lo active.')
    if (row && !row.enabled && !flag('enable'))
      throw new Error('el interruptor general de seguimientos está APAGADO para este negocio; --enable lo enciende (reanuda también las rondas activas de los otros agentes)')
    if (DRY) return campaign
    if (row) {
      await mutateCampaigns(row.id, (raw) => [...stopWhere((c) => c.agentId === agentId)(raw), campaign as unknown as RawCampaign])
      if (!row.enabled) await prisma.tenantFeatureFlag.update({ where: { id: row.id }, data: { enabled: true } })
    } else await prisma.tenantFeatureFlag.create({ data: { scope: tenantId, tenantId, key: FOLLOW_UP_FLAG, enabled: true, config: { campaigns: [campaign] } as object } })
    await audit(`Follow-up A/B creado ${campaign.id}`, { campaignId: campaign.id, agentId, lineIds, until: campaign.until, textA: a, textB: b, keys: campaign.keys ?? null, stopped, why: input.why })
    console.log(`Campaña ${campaign.id} activa hasta ${campaign.until}.`)
    return campaign
  }

  if (flag('create')) {
    const keys = arg('keys')?.split(',')
    await createCampaign({
      agentId: arg('agent') || '',
      lineIds: (arg('lines') || '').split(',').filter(Boolean),
      a: (arg('a') || '').trim(),
      b: (arg('b') || '').trim(),
      keys: keys?.length === 2 ? [keys[0], keys[1]] : undefined,
      hours: Number(arg('hours') || 18),
      silent: Number(arg('silent-min') || 90),
      why: 'a mano',
    })
    return
  }

  if (flag('start') || flag('rotate')) {
    const { plan, file } = loadPlan(packDir)
    if (plan.status === 'on_hold') throw new Error(`${plan.agentName}: plan en espera (on_hold) — no se inicia`)
    const agent = await prisma.chatAgent.findFirst({ where: { id: plan.agentId, tenantId }, select: { status: true } })
    if (agent?.status !== 'live') throw new Error(`${plan.agentName}: el agente está ${agent?.status ?? 'sin encontrar'} — se inicia cuando Rafael lo active`)
    let champion = plan.champion
    let challenger = currentChallenger(plan)
    const retired = { ...(plan.retired ?? {}) }
    let why = 'primera ronda'
    if (flag('rotate') && challenger) {
      const mine = campaigns.filter((c) => c.agentId === plan.agentId)
      const [champ, chall] = await pairStats(tenantId, mine, plan, [champion, challenger])
      printArm('campeón', champ)
      printArm('retador', chall)
      const verdict = decideWinner(champ, chall)
      console.log(`→ ${verdict.kind}: ${verdict.reason}`)
      why = `${verdict.kind}: ${verdict.reason}`
      if (verdict.kind === 'stop_agent') {
        console.log(DRY ? '[dry-run] detendría las campañas de este agente' : 'Deteniendo las campañas de este agente.')
        if (!DRY && row) {
          await mutateCampaigns(row.id, stopWhere((c) => c.agentId === plan.agentId))
          await audit(`Follow-up detenido por bajas (${plan.agentName})`, { agentId: plan.agentId, why })
        }
        return
      }
      if (verdict.kind === 'challenger_wins') {
        retired[champion] = `perdió contra "${challenger}" ${new Date().toISOString().slice(0, 10)}: ${verdict.reason}`
        champion = challenger
      } else if (verdict.kind === 'champion_keeps' || verdict.kind === 'challenger_dropped') {
        retired[challenger] = `${new Date().toISOString().slice(0, 10)}: ${verdict.reason}`
      }
      challenger = currentChallenger({ ...plan, champion, retired })
    }
    if (!challenger) throw new Error(`${plan.agentName}: no quedan retadores — agregá textos nuevos en follow-up.json (challengers)`)
    const armSlots = (key: string) => parseStageTexts(plan.stageTexts?.[key])
    const stageTexts = { ...(armSlots(champion) ? { A: armSlots(champion) } : {}), ...(armSlots(challenger) ? { B: armSlots(challenger) } : {}) }
    await createCampaign({
      agentId: plan.agentId,
      lineIds: plan.lineIds,
      a: plan.texts[champion],
      b: plan.texts[challenger],
      keys: [champion, challenger],
      hours: plan.roundHours,
      silent: plan.silentMinutes,
      why,
      ...(Object.keys(stageTexts).length ? { stageTexts } : {}),
    })
    if (!DRY && (champion !== plan.champion || JSON.stringify(retired) !== JSON.stringify(plan.retired ?? {}))) {
      writeFileSync(file, `${JSON.stringify({ ...plan, champion, retired }, null, 2)}\n`)
      console.log(`follow-up.json actualizado: campeón "${champion}".`)
    }
    return
  }

  if (flag('stop')) {
    const id = arg('id')
    const agentId = arg('agent')
    if (!row) throw new Error('no hay campañas')
    if (id && !campaigns.some((c) => c.id === id)) throw new Error(`no existe la campaña ${id}`)
    // The cron renews a round under a new id (renewedFrom): an old id stops the round its chain leads to. Verifier r2:
    // the chain is rebuilt from the LOCKED array too, so a renewal between the read and the write is stopped as well.
    const chainOf = (list: Array<{ id?: unknown; renewedFrom?: unknown }>) => {
      const chain = new Set(id ? [id] : [])
      for (let grew = true; grew; ) {
        grew = false
        for (const c of list) {
          if (c && typeof c.id === 'string' && typeof c.renewedFrom === 'string' && chain.has(c.renewedFrom) && !chain.has(c.id)) {
            chain.add(c.id)
            grew = true
          }
        }
      }
      return chain
    }
    const chain = chainOf(campaigns as Array<{ id?: unknown; renewedFrom?: unknown }>)
    const hit = (c: StoredCampaign) => (id ? chain.has(c.id) : agentId ? c.agentId === agentId : true)
    console.log(`${DRY ? '[dry-run] detendría' : 'Detiene'}: ${campaigns.filter((c) => hit(c) && c.active).map((c) => c.id).join(', ') || '(ninguna activa)'}`)
    if (DRY) return
    await mutateCampaigns(row.id, (raw) => {
      const locked = chainOf(raw)
      return stopWhere((c) => (id ? locked.has(String(c.id)) : agentId ? c.agentId === agentId : true))(raw)
    })
    await audit(`Follow-up A/B detenido ${id || agentId || '(todas)'}`, { campaignId: id || null, agentId: agentId || null })
    console.log('Detenida.')
    return
  }

  // Who could get a follow-up right now, per line, and why the rest can't (read-only). Per-chat filters only — an upper bound: the
  // run-time checks (agent live, business hours, line answering, kill switch, tokens, jobs in flight) still apply at send.
  if (flag('eligible')) {
    const { plan } = loadPlan(packDir)
    const now = Date.now()
    const silentBefore = new Date(now - plan.silentMinutes * 60_000)
    for (const lineId of plan.lineIds) {
      const convs = await prisma.chatConversation.findMany({
        where: { tenantId, socialAccountId: lineId, lastInboundAt: { gte: new Date(now - FOLLOW_UP_WINDOW_MS) } },
        select: { id: true, aiMode: true, tags: true, status: true, lastMessageDirection: true, lastMessageAt: true, lastInboundAt: true },
      })
      const reasons: Record<string, number> = {}
      for (const conv of convs) {
        const why =
          conv.lastMessageDirection !== 'outbound'
            ? 'customer_wrote_last'
            : conv.lastMessageAt > silentBefore || (conv.lastInboundAt && conv.lastInboundAt > silentBefore)
              ? 'not_silent_yet'
              : ((await followUpSkipReason(tenantId, conv)) ?? 'ELIGIBLE')
        reasons[why] = (reasons[why] ?? 0) + 1
      }
      console.log(`${lineId}: ${convs.length} chats en la ventana de 23 h · ${JSON.stringify(reasons)}`)
    }
    return
  }

  // Report (read-only).
  const plan =existsSync(join(packDir, 'follow-up.json')) ? loadPlan(packDir).plan : undefined
  const list = arg('id') ? campaigns.filter((c) => c.id === arg('id')) : campaigns
  for (const c of list) {
    const stats = await campaignStats(tenantId, c)
    const why = (c as { stopReason?: string }).stopReason
    const state = !c.active
      ? why === 'auto_renew'
        ? 'renovada'
        : why === 'opt_out_guard'
          ? 'DETENIDA POR BAJAS'
          : 'detenida'
      : Date.parse(c.until) > Date.now()
        ? 'ACTIVA'
        : c.keys && Date.now() - Date.parse(c.until) <= RENEW_MAX_AGE_MS
          ? 'terminada (el cron la renueva si el agente está live)'
          : 'terminada'
    console.log(`${c.id} · agente ${c.agentId} · ${state} · ${c.createdAt} → ${c.until} · espera ${c.silentMinMinutes} min · reservados ${Object.keys(c.claimed).length}`)
    for (const v of VARIANTS) {
      const s = stats[v]
      console.log(
        `  ${v} (${keyOf(c, v, plan)}): enviados ${s.sent} · fallidos ${s.failed} · respondieron ${s.replied} (${pct(s.replied, s.sent)}) · pedidos ${s.ordered} (${pct(s.ordered, s.sent)}) · ${crc(s.revenue)} · bajas ${s.optedOut} (${pct(s.optedOut, s.sent)}) · "no gracias" ${s.softNo} · por línea ${JSON.stringify(s.byLine)}`,
      )
      console.log(`     "${c.texts[v]}"`)
      if (flag('replies')) for (const r of s.replies) console.log(`       ↳ ${r}`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
