/**
 * luna-10 (SecureDog): the one way the exam / mystery shoppers / silent trial touch a business.
 *  - refuses when the business has not accepted the AI terms, the kill switch is armed or the platform AI is paused
 *    (their customers' chats must never reach the AI provider without consent / during an incident);
 *  - the actor must be an active OWNER / ADMIN of the business;
 *  - the daily TEST token cap is raised only for the run, both changes are written to the audit log, and it is
 *    restored in `finally` AND on Ctrl+C / SIGTERM (a stuck raise would let admins spend more on Betsy's key);
 *  - never stacks with another run: a real lock row (test-lock.ts, Sleeping exam C4) is taken first, atomically, and
 *    released at the end (expires on its own after 6 h if the process died); the "cap already raised" refusal stays.
 */
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/auditLogger'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { isAiTermsAcceptedNow } from '@/lib/soft-ai/agent-ai-terms-server'
import { isPlatformAiPaused, readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'
import { acquireTestLock, releaseTestLock, type LockDb } from './test-lock'

export type ExamActor = { id: string; name: string; role: string }

export async function withExamSession<T>(
  input: { tenantId: string; actorEmail: string; cap: number; label: 'exam' | 'shoppers' | 'shadow' },
  fn: (actor: ExamActor) => Promise<T>,
): Promise<T> {
  const { tenantId } = input
  if (!Number.isFinite(input.cap) || input.cap <= 0 || input.cap > 20_000_000) throw new Error('--cap debe ser un número entre 1 y 20 000 000')
  if (!(await isAiTermsAcceptedNow(tenantId))) throw new Error('El negocio no aceptó los términos de IA: no se usan sus chats con la IA.')
  if ((await readAgentKillState(tenantId)).armed) throw new Error('El freno de emergencia de la IA está activo en este negocio.')
  if (await isPlatformAiPaused()) throw new Error('La IA de la plataforma está en pausa.')
  const user = await prisma.user.findUnique({ where: { email: input.actorEmail }, select: { id: true, name: true } })
  const member = user ? await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } }) : null
  if (!user || !member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error(`${input.actorEmail} debe ser OWNER o ADMIN activo del negocio`)
  const actor: ExamActor = { id: user.id, name: `${user.name || 'Owner'} (${input.label} script)`, role: String(member.role) }

  const lockDb = prisma as unknown as LockDb
  const lock = await acquireTestLock(lockDb, { tenantId, label: input.label, cap: input.cap })
  const auditLock = (why: string) =>
    logAudit({
      action: 'UPDATE',
      entityType: 'ChatAgentLayerConfig',
      entityId: tenantId,
      description: `test lock ${why} (${input.label}, pid ${process.pid}, hasta ${lock.expiresAt})`,
      newValues: { testLock: why, label: input.label, startedAt: lock.startedAt, expiresAt: lock.expiresAt },
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      tenantId,
    }).catch(() => undefined)
  const audit = (from: number, to: number, why: string) =>
    logAudit({
      action: 'UPDATE',
      entityType: 'ChatAgentLayerConfig',
      entityId: tenantId,
      description: `testDailyTokenCap ${from} → ${to} (${input.label}: ${why})`,
      oldValues: { testDailyTokenCap: from },
      newValues: { testDailyTokenCap: to },
      userId: actor.id,
      userName: actor.name,
      userRole: actor.role,
      tenantId,
    }).catch(() => undefined)

  let lockReleased = false
  const releaseLock = async () => {
    if (lockReleased) return
    lockReleased = true
    // SecureDog r1 INFRA-23: "liberado" is written only when the release really happened.
    const ok = await releaseTestLock(lockDb, { tenantId, token: lock.token }).catch(() => false)
    await auditLock(ok ? 'liberado' : 'no se pudo liberar (vence solo; o test-cap --unlock)')
  }
  let before = 0
  let restored = false
  let raised = false
  const restore = async (why: string) => {
    if (restored || !raised) return
    restored = true
    // Only our own raise is undone: an admin's change during the run is kept.
    const res = await mutateChatAgentLayerConfig(tenantId, (c) => (c.testDailyTokenCap === input.cap ? { ...c, testDailyTokenCap: before } : c))
    if (res.after.testDailyTokenCap === res.before.testDailyTokenCap) return
    await audit(input.cap, before, why)
    console.log(`Tope de pruebas restaurado: ${before.toLocaleString('es-CR')}`)
  }
  // Verifier r1 #7: the handlers go up right after the lock is taken, so Ctrl+C at any later point releases it.
  const onSignal = (sig: string) => {
    void restore(`interrumpido (${sig})`)
      .finally(() => releaseLock())
      .finally(() => process.exit(130))
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    await auditLock('tomado')
    before = parseChatAgentLayerConfig((await readChatAgentLayerConfig(tenantId)).config).testDailyTokenCap
    // Sleeping C4: a cap left raised by an earlier run (not the business's normal value) refuses ANY new run, whatever cap
    // it asks — restore it first (test-cap --restore --to=<normal>).
    if (lock.baseCap !== undefined && before !== lock.baseCap) {
      throw new Error(
        `El tope de pruebas está en ${before.toLocaleString('es-CR')} y lo normal registrado es ${lock.baseCap.toLocaleString('es-CR')}. Si quedó subido por otra prueba: test-cap --restore --to=${lock.baseCap}. Si el dueño lo cambió a propósito: test-cap --restore --to=${before} (lo registra como el nuevo normal).`,
      )
    }
    if (before >= input.cap) throw new Error(`El tope de pruebas ya está en ${before.toLocaleString('es-CR')}: otra prueba está corriendo (o quedó subido: bajalo desde Agentes).`)
    // SecureDog r1 INFRA-23: marked BEFORE the raise, so a Ctrl+C or error while it is in flight still restores (the
    // restore only resets a value equal to our own cap, so a raise that never landed changes nothing).
    raised = true
    await mutateChatAgentLayerConfig(tenantId, (c) => ({ ...c, testDailyTokenCap: Math.max(c.testDailyTokenCap, input.cap) }))
    await audit(before, input.cap, 'inicio')
    console.log(`Tope de pruebas: ${before.toLocaleString('es-CR')} → ${input.cap.toLocaleString('es-CR')} (se restaura al final)`)
    return await fn(actor)
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    try {
      await restore('fin')
    } finally {
      await releaseLock()
    }
  }
}
