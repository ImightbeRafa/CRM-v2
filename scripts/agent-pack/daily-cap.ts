/**
 * luna-10 go-live: set a business's daily LIVE token cap (dailyTokenCap) — audited, OWNER/ADMIN actor — and optionally
 * re-run the "line turned on" sweep for one line (answers the chats left waiting, each message once).
 *
 *   … scripts/agent-pack/daily-cap.ts --pack=../betsy-agent-packs/patchhouse --cap=2000000 [--sweep=<socialAccountId>]
 */
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/auditLogger'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { loadDailyBilledTokens } from '@/lib/soft-ai/agent-claim-gates'
import { sweepWaitingChats } from '@/lib/soft-ai/waiting-sweep'
import { loadPack } from './pack'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { pack } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true, name: true } })
  const member = user ? await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } }) : null
  if (!user || !member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error(`${pack.target.actorEmail} debe ser OWNER o ADMIN activo`)
  const before = parseChatAgentLayerConfig((await readChatAgentLayerConfig(tenantId)).config).dailyTokenCap
  const cap = Number(arg('cap') || 0)
  if (cap > 0 && cap !== before) {
    if (!Number.isFinite(cap) || cap > 10_000_000) throw new Error('--cap entre 1 y 10 000 000')
    await mutateChatAgentLayerConfig(tenantId, (c) => ({ ...c, dailyTokenCap: cap }))
    await logAudit({
      action: 'UPDATE',
      entityType: 'ChatAgentLayerConfig',
      entityId: tenantId,
      description: `dailyTokenCap ${before} → ${cap} (go-live Instagram PatchHouse; pedido de Rafael)`,
      oldValues: { dailyTokenCap: before },
      newValues: { dailyTokenCap: cap },
      userId: user.id,
      userName: `${user.name || 'Owner'} (daily-cap script)`,
      userRole: String(member.role),
      tenantId,
    })
    console.log(`Tope diario (chats reales): ${before.toLocaleString('es-CR')} → ${cap.toLocaleString('es-CR')} · usado hoy ${(await loadDailyBilledTokens(tenantId)).toLocaleString('es-CR')}`)
  } else {
    console.log(`Tope diario (chats reales): ${before.toLocaleString('es-CR')} · usado hoy ${(await loadDailyBilledTokens(tenantId)).toLocaleString('es-CR')}`)
  }
  const line = arg('sweep')
  if (line) {
    const res = await sweepWaitingChats(tenantId, line)
    console.log('Barrido:', JSON.stringify(res))
    const waitMs = Number(arg('wait-ms') || 180_000)
    console.log(`Esperando ${Math.round(waitMs / 1000)} s para que salgan las respuestas…`)
    await sleep(waitMs)
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
