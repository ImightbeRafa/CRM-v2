/**
 * luna-10: switch an agent to a model and turn one line on, with the SAME server functions the Agentes buttons use
 * (updateChatAgent → powerOnLine → quick 6-case check → activateAfterQuickRun → waiting sweep). Every step is audited
 * by those functions; the actor is the pack's owner / admin. Refuses exactly where the button would refuse.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/agent-pack/go-live-line.ts \
 *     --pack=../betsy-agent-packs/patchhouse --agent=<id> --account=<socialAccountId> [--model=gpt-6-luna] [--wait-ms=120000]
 */
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { powerOnLine, ActivationRefusal, ACTIVATION_REFUSAL_COPY } from '@/lib/soft-ai/agent-activation'
import { drainAgentTestRun, latestTestRun } from '@/lib/soft-ai/test-engine/run'
import { loadPack } from './pack'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { pack } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const agentId = arg('agent') || ''
  const accountId = arg('account') || ''
  const model = arg('model')
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true, name: true } })
  const member = user ? await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } }) : null
  if (!user || !member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error(`${pack.target.actorEmail} debe ser OWNER o ADMIN activo`)
  const actor = { actorUserId: user.id, actorName: user.name || pack.target.actorEmail, actorRole: String(member.role) }

  const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId }, select: { id: true, name: true, model: true, version: true } })
  if (!agent) throw new Error('agente no encontrado')
  if (model && agent.model !== model) {
    const updated = await updateChatAgent({ tenantId, agentId, ...actor, patch: { model } })
    console.log(`Modelo: ${agent.model} → ${(updated as { model?: string }).model ?? model}`)
  } else {
    console.log(`Modelo: ${agent.model} (sin cambio)`)
  }

  let res
  try {
    res = await powerOnLine({ tenantId, agentId, socialAccountId: accountId, ...actor })
  } catch (e) {
    if (e instanceof ActivationRefusal) throw new Error(`Rechazado (${e.code}): ${ACTIVATION_REFUSAL_COPY[e.code]}`)
    throw e
  }
  if (res.state === 'on') {
    console.log('Línea ENCENDIDA (prueba vigente reutilizada). Barrido de chats en espera en curso…')
  } else {
    console.log(`Prueba rápida iniciada (${res.total} casos, run ${res.runId}). Corriendo…`)
    for (let i = 0; i < 30; i++) {
      await drainAgentTestRun(tenantId, res.runId)
      const run = await latestTestRun(tenantId, agentId, accountId)
      if (run && run.id === res.runId && !['queued', 'running'].includes(run.status)) {
        console.log(`Prueba: ${run.status} · ${JSON.stringify(run.summary)}`)
        if (run.status !== 'passed') {
          console.log('La línea NO se encendió (la prueba no pasó).')
          return
        }
        break
      }
      await sleep(3000)
    }
  }
  const cfg = await prisma.tenantFeatureFlag.findFirst({ where: { tenantId, scope: tenantId, key: 'chat_agent_layer_v1' }, select: { config: true } })
  const allow = ((cfg?.config as { accountAllowlist?: string[] } | null)?.accountAllowlist ?? []).includes(accountId)
  console.log(`Línea en la lista de canales con IA: ${allow ? 'SÍ' : 'NO'}`)
  // Keep the process alive while the sweep's first answers go out (the server cron is the safety net).
  const waitMs = Number(arg('wait-ms') || 120_000)
  console.log(`Esperando ${Math.round(waitMs / 1000)} s para que salgan las primeras respuestas…`)
  await sleep(waitMs)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
