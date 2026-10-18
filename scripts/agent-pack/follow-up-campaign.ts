/**
 * Follow-up A/B campaign (follow-up.ts): create / stop / report — audited, OWNER/ADMIN actor from the pack.
 *
 *   … follow-up-campaign.ts --pack=../betsy-agent-packs/patchhouse --agent=<id> --lines=<id,id> --create \
 *       --a="texto A" --b="texto B" [--hours=18] [--silent-min=90]
 *   … --stop --id=<campaignId>
 *   … --report [--id=<campaignId>]          (read-only)
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/auditLogger'
import { FOLLOW_UP_FLAG, MAX_CAMPAIGN_HOURS, SILENT_MIN_MINUTES, parseFollowUpConfig, type FollowUpCampaign } from '@/lib/soft-ai/follow-up'
import { loadPack } from './pack'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const { pack } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true, name: true } })
  const member = user ? await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } }) : null
  if (!user || !member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error(`${pack.target.actorEmail} debe ser OWNER o ADMIN activo`)
  const row = await prisma.tenantFeatureFlag.findFirst({ where: { scope: tenantId, key: FOLLOW_UP_FLAG } })
  const config = parseFollowUpConfig(row?.config)
  const audit = (description: string, newValues: Record<string, unknown>) =>
    logAudit({ action: 'UPDATE', entityType: 'FollowUpCampaign', entityId: tenantId, description, newValues, userId: user.id, userName: `${user.name || 'Owner'} (follow-up script)`, userRole: String(member.role), tenantId })

  if (flag('create')) {
    const agentId = arg('agent') || ''
    const lineIds = (arg('lines') || '').split(',').filter(Boolean)
    const a = (arg('a') || '').trim()
    const b = (arg('b') || '').trim()
    if (!agentId || !lineIds.length || !a || !b) throw new Error('--agent, --lines, --a y --b son obligatorios')
    if (a.length > 500 || b.length > 500) throw new Error('textos de máximo 500 caracteres')
    const hours = Number(arg('hours') || 18)
    const silent = Number(arg('silent-min') || 90)
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_CAMPAIGN_HOURS) throw new Error(`--hours entre 1 y ${MAX_CAMPAIGN_HOURS}`)
    if (!Number.isFinite(silent) || silent < SILENT_MIN_MINUTES || silent > 1440) throw new Error(`--silent-min entre ${SILENT_MIN_MINUTES} y 1440`)
    const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId }, select: { id: true } })
    if (!agent) throw new Error('agente no encontrado en este negocio')
    const lines = await prisma.socialAccount.count({ where: { id: { in: lineIds }, tenantId } })
    if (lines !== lineIds.length) throw new Error('alguna línea no es de este negocio')
    const now = Date.now()
    const campaign: FollowUpCampaign = {
      id: `fu-${new Date(now).toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`,
      agentId,
      lineIds,
      texts: { A: a, B: b },
      createdAt: new Date(now).toISOString(),
      until: new Date(now + hours * 3600_000).toISOString(),
      silentMinMinutes: silent,
      active: true,
      claimed: {},
    }
    const next = { campaigns: [...config.campaigns.map((c) => ({ ...c, active: false })), campaign] }
    if (row) await prisma.tenantFeatureFlag.update({ where: { id: row.id }, data: { enabled: true, config: next } })
    else await prisma.tenantFeatureFlag.create({ data: { scope: tenantId, tenantId, key: FOLLOW_UP_FLAG, enabled: true, config: next } })
    await audit(`Follow-up A/B creado ${campaign.id}`, { campaignId: campaign.id, lineIds, until: campaign.until, textA: a, textB: b })
    console.log(`Campaña ${campaign.id} activa hasta ${campaign.until} (anteriores detenidas).`)
    return
  }
  if (flag('stop')) {
    const id = arg('id')
    if (!row) throw new Error('no hay campañas')
    if (id && !config.campaigns.some((c) => c.id === id)) throw new Error(`no existe la campaña ${id}`)
    const next = { campaigns: config.campaigns.map((c) => (!id || c.id === id ? { ...c, active: false } : c)) }
    await prisma.tenantFeatureFlag.update({ where: { id: row.id }, data: { config: next } })
    await audit(`Follow-up A/B detenido ${id || '(todas)'}`, { campaignId: id || 'all' })
    console.log('Detenida.')
    return
  }
  // Report (read-only).
  const list = arg('id') ? config.campaigns.filter((c) => c.id === arg('id')) : config.campaigns
  for (const c of list) {
    const stats: Record<string, { sent: number; failed: number; replied: number; ordered: number; orderAlert: number }> = {}
    for (const [convId, v] of Object.entries(c.claimed)) {
      const variant = v.replace('!', '')
      const s = (stats[variant] ??= { sent: 0, failed: 0, replied: 0, ordered: 0, orderAlert: 0 })
      if (v.endsWith('!')) {
        s.failed++
        continue
      }
      s.sent++
      const fu = await prisma.chatMessage.findFirst({
        where: { tenantId, conversationId: convId, direction: 'outbound', metadata: { path: ['followUp', 'campaignId'], equals: c.id } },
        select: { sentAt: true },
      })
      if (!fu) {
        // Claimed but never stored as sent: not counted as sent (keeps the rates honest).
        s.sent--
        s.failed++
        continue
      }
      const replied = await prisma.chatMessage.count({ where: { tenantId, conversationId: convId, direction: 'inbound', sentAt: { gt: fu.sentAt } } })
      if (replied) s.replied++
      // Chats with an order were never followed up, so any linked order now came after the follow-up.
      const ordered = await prisma.chatMessage.count({ where: { tenantId, conversationId: convId, orderId: { not: null } } })
      if (ordered) s.ordered++
      const conv = await prisma.chatConversation.findFirst({ where: { id: convId, tenantId }, select: { tags: true } })
      if (conv?.tags.includes('Pedido por confirmar') || conv?.tags.includes('Pago por verificar')) s.orderAlert++
    }
    console.log(`${c.id} · ${c.active ? 'ACTIVA' : 'detenida'} · hasta ${c.until}`)
    for (const v of ['A', 'B']) {
      const s = stats[v] ?? { sent: 0, failed: 0, replied: 0, ordered: 0, orderAlert: 0 }
      const pct = (n: number) => (s.sent ? `${Math.round((n / s.sent) * 100)}%` : '–')
      console.log(`  ${v}: enviados ${s.sent} · fallidos ${s.failed} · respondieron ${s.replied} (${pct(s.replied)}) · pedidos ${s.ordered} (${pct(s.ordered)}) · aviso pago/pedido ${s.orderAlert}`)
      console.log(`     "${c.texts[v as 'A' | 'B']}"`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
