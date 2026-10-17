/**
 * luna-10 (SecureDog): the one way the exam / mystery shoppers / silent trial touch a business.
 *  - refuses when the business has not accepted the AI terms, the kill switch is armed or the platform AI is paused
 *    (their customers' chats must never reach the AI provider without consent / during an incident);
 *  - the actor must be an active OWNER / ADMIN of the business;
 *  - the daily TEST token cap is raised only for the run, both changes are written to the audit log, and it is
 *    restored in `finally` AND on Ctrl+C / SIGTERM (a stuck raise would let admins spend more on Betsy's key);
 *  - never stacks with another run (the cap is already raised → refuse).
 */
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/auditLogger'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { isAiTermsAcceptedNow } from '@/lib/soft-ai/agent-ai-terms-server'
import { isPlatformAiPaused, readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'

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

  const before = parseChatAgentLayerConfig((await readChatAgentLayerConfig(tenantId)).config).testDailyTokenCap
  if (before >= input.cap) throw new Error(`El tope de pruebas ya está en ${before.toLocaleString('es-CR')}: otra prueba está corriendo (o quedó subido: bajalo desde Agentes).`)
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

  let restored = false
  const restore = async (why: string) => {
    if (restored) return
    restored = true
    // Only our own raise is undone: an admin's change during the run is kept.
    await mutateChatAgentLayerConfig(tenantId, (c) => (c.testDailyTokenCap === input.cap ? { ...c, testDailyTokenCap: before } : c))
    await audit(input.cap, before, why)
    console.log(`Tope de pruebas restaurado: ${before.toLocaleString('es-CR')}`)
  }
  const onSignal = (sig: string) => {
    void restore(`interrumpido (${sig})`).finally(() => process.exit(130))
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  await mutateChatAgentLayerConfig(tenantId, (c) => ({ ...c, testDailyTokenCap: Math.max(c.testDailyTokenCap, input.cap) }))
  await audit(before, input.cap, 'inicio')
  console.log(`Tope de pruebas: ${before.toLocaleString('es-CR')} → ${input.cap.toLocaleString('es-CR')} (se restaura al final)`)
  try {
    return await fn(actor)
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    await restore('fin')
  }
}
