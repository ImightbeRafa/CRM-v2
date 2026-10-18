/**
 * luna-10: raise / restore a business's daily TEST token cap by hand (e.g. so the quick check before "Activar" can run
 * after a day of exams). Same safeguards as test-session.ts: OWNER / ADMIN actor, both changes in the audit log, the
 * restore only undoes our own raise (an admin's later change is kept).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/agent-pack/test-cap.ts \
 *     --pack=../betsy-agent-packs/patchhouse --raise --headroom=1500000
 *   … --restore --to=800000
 *   … --unlock   (Sleeping C4: frees the test-run lock a dead run left behind; audited. Only when no run is going.)
 */
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/auditLogger'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { loadDailyTestTokens } from '@/lib/soft-ai/agent-claim-gates'
import { loadPack } from './pack'
import { activeLock, forceReleaseTestLock, lockHolderGone, readTestLock, type LockDb } from './test-lock'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const { pack } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true, name: true } })
  const member = user ? await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } }) : null
  if (!user || !member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error(`${pack.target.actorEmail} debe ser OWNER o ADMIN activo del negocio`)
  const actor = { id: user.id, name: `${user.name || 'Owner'} (test-cap script)`, role: String(member.role) }
  const current = parseChatAgentLayerConfig((await readChatAgentLayerConfig(tenantId)).config).testDailyTokenCap
  const audit = (from: number, to: number, why: string) =>
    logAudit({
      action: 'UPDATE',
      entityType: 'ChatAgentLayerConfig',
      entityId: tenantId,
      description: `testDailyTokenCap ${from} → ${to} (test-cap: ${why})`,
      oldValues: { testDailyTokenCap: from },
      newValues: { testDailyTokenCap: to },
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      tenantId,
    })

  if (flag('raise')) {
    // Today's test usage, exactly as the quick check / test turns count it.
    const usedTokens = await loadDailyTestTokens(tenantId)
    const headroom = Number(arg('headroom') || 1_500_000)
    const target = Math.min(25_000_000, Math.max(current, usedTokens + headroom))
    if (!Number.isFinite(target) || target <= current) {
      console.log(`Tope de pruebas ya alcanza: ${current.toLocaleString('es-CR')} (usado hoy ≈ ${usedTokens.toLocaleString('es-CR')})`)
      return
    }
    await mutateChatAgentLayerConfig(tenantId, (c) => ({ ...c, testDailyTokenCap: Math.max(c.testDailyTokenCap, target) }))
    await audit(current, target, `subido a mano para la prueba rápida (usado hoy ≈ ${usedTokens})`)
    console.log(`Tope de pruebas: ${current.toLocaleString('es-CR')} → ${target.toLocaleString('es-CR')} (usado hoy ≈ ${usedTokens.toLocaleString('es-CR')}). Restaurar con --restore --to=800000`)
    return
  }
  const lockDb = prisma as unknown as LockDb
  if (flag('unlock')) {
    // SecureDog r2 INFRA-24: never free the lock of a run that is still going (its restore would then leave the cap
    // raised). Only a run on THIS machine whose process is gone, unless --force.
    const held = activeLock(await readTestLock(lockDb, tenantId), new Date())
    if (held && !flag('force') && !lockHolderGone(held)) {
      throw new Error(`La prueba que tiene el candado sigue corriendo o es de otra máquina (${held.label}, ${held.host} pid ${held.pid}). Esperá que termine, o --unlock --force.`)
    }
    const freed = await forceReleaseTestLock(lockDb, { tenantId, ...(held ? { expectToken: held.token } : {}) })
    if (!freed) {
      console.log('No hay ninguna prueba con el candado tomado.')
      return
    }
    await logAudit({
      action: 'UPDATE',
      entityType: 'ChatAgentLayerConfig',
      entityId: tenantId,
      description: `test lock liberado a mano (test-cap --unlock; era de ${freed.label}, pid ${freed.pid}, desde ${freed.startedAt})`,
      oldValues: { testLock: freed.label, startedAt: freed.startedAt },
      newValues: { testLock: 'liberado a mano' },
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      tenantId,
    })
    console.log(`Candado liberado (era de ${freed.label}, ${freed.host} pid ${freed.pid}, desde ${freed.startedAt}).`)
    return
  }
  if (flag('restore')) {
    // Verifier r1 #7: never lower the cap under a run that is still going (its rows would end "not run").
    const held = activeLock(await readTestLock(lockDb, tenantId), new Date())
    if (held && !flag('force')) throw new Error(`Hay una prueba corriendo (${held.label}, pid ${held.pid}, desde ${held.startedAt}). Esperá que termine, o --force.`)
    const to = Number(arg('to') || 800_000)
    if (!Number.isFinite(to) || to <= 0) throw new Error('--to debe ser un número positivo')
    if (current <= to) {
      console.log(`Nada que restaurar: el tope ya está en ${current.toLocaleString('es-CR')}`)
      return
    }
    await mutateChatAgentLayerConfig(tenantId, (c) => (c.testDailyTokenCap === current ? { ...c, testDailyTokenCap: to } : c))
    await audit(current, to, 'restaurado a mano')
    console.log(`Tope de pruebas restaurado: ${current.toLocaleString('es-CR')} → ${to.toLocaleString('es-CR')}`)
    return
  }
  console.log(`Tope de pruebas actual: ${current.toLocaleString('es-CR')}. Usá --raise o --restore.`)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
