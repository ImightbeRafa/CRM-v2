/**
 * Seed the `custom_agents` flag ON for businesses that already run an AI agent, so turning the
 * support pipeline on (SUPPORT_PIPELINE_ENABLED=true) does not lock them out of their agent editor.
 * Run BEFORE flipping the switch. See docs/runbooks/support-pipeline.md.
 *
 * Picks a business when ANY of:
 *   - an active binding (a channel or the business-wide default) to an agent whose mode is not human_only;
 *   - an agent turn in the last 30 days;
 *   - it is listed in ALWAYS_ON below (DeepSleep).
 * Never overrides an existing row (an explicit OFF set by Rafael stays OFF). Writes the flag and an
 * AuditLog row per business in one transaction.
 *
 * Dry run (default, read-only — prints the list for Rafael to approve):
 *   npx tsx --import ./scripts/shim-server-only.mjs scripts/seed-custom-agents-flag.ts
 * Apply (shared production DB — Rafael's GO only):
 *   SEED_CUSTOM_AGENTS_APPLY=1 npx tsx --import ./scripts/shim-server-only.mjs scripts/seed-custom-agents-flag.ts --apply
 */
import { prisma } from '../src/lib/db'
import { CUSTOM_AGENTS_FLAG } from '../src/lib/feature-flags'

const ALWAYS_ON = ['cmhsibjue0004js04gie724nx'] // DeepSleep (task brief, 2026-10-22)
const TURN_WINDOW_DAYS = 30

async function main() {
  const apply = process.argv.includes('--apply') && process.env.SEED_CUSTOM_AGENTS_APPLY === '1'
  const since = new Date(Date.now() - TURN_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const [bindings, turns, existing] = await Promise.all([
    prisma.chatAgentBinding.findMany({
      where: { isActive: true },
      select: { tenantId: true, agentId: true },
    }),
    prisma.chatAgentTurn.groupBy({ by: ['tenantId'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.tenantFeatureFlag.findMany({ where: { key: CUSTOM_AGENTS_FLAG }, select: { scope: true, enabled: true } }),
  ])
  const agentIds = [...new Set(bindings.map((b) => b.agentId))]
  const agents = agentIds.length
    ? await prisma.chatAgent.findMany({ where: { id: { in: agentIds } }, select: { id: true, tenantId: true, operationMode: true } })
    : []
  const aiAgentsByTenant = new Map<string, Set<string>>()
  for (const a of agents) {
    if (a.operationMode === 'human_only') continue
    const set = aiAgentsByTenant.get(a.tenantId) ?? new Set<string>()
    set.add(a.id)
    aiAgentsByTenant.set(a.tenantId, set)
  }
  const reasons = new Map<string, string[]>()
  const add = (t: string, r: string) => reasons.set(t, [...(reasons.get(t) ?? []), r])
  for (const [t, ids] of aiAgentsByTenant) add(t, `${ids.size} agente(s) con binding activo`)
  for (const t of turns) add(t.tenantId, `${t._count._all} turnos en ${TURN_WINDOW_DAYS} días`)
  for (const t of ALWAYS_ON) add(t, 'lista fija')

  const existingBy = new Map(existing.map((e) => [e.scope, e.enabled]))
  const tenants = await prisma.tenant.findMany({ where: { id: { in: [...reasons.keys()] } }, select: { id: true, name: true } })
  const names = new Map(tenants.map((t) => [t.id, t.name]))

  const plan = [...reasons.keys()]
    .filter((id) => names.has(id))
    .map((id) => ({
      id,
      name: names.get(id)!,
      reasons: reasons.get(id)!,
      existing: existingBy.has(id) ? (existingBy.get(id) ? 'ON' : 'OFF (se respeta)') : null,
      agentIds: [...(aiAgentsByTenant.get(id) ?? [])],
    }))
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${plan.length} negocio(s):`)
  for (const p of plan) {
    console.log(`- ${p.name} (${p.id}): ${p.reasons.join('; ')}${p.existing ? ` — ya tiene fila: ${p.existing}` : ''}`)
  }
  const toWrite = plan.filter((p) => p.existing === null)
  console.log(`A escribir: ${toWrite.length}. Sin cambios: ${plan.length - toWrite.length}.`)
  if (!apply) {
    console.log('Nada escrito. Para aplicar: SEED_CUSTOM_AGENTS_APPLY=1 npx tsx --import ./scripts/shim-server-only.mjs scripts/seed-custom-agents-flag.ts --apply')
    return
  }
  const now = new Date().toISOString()
  for (const p of toWrite) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.tenantFeatureFlag.upsert({
        where: { scope_key: { scope: p.id, key: CUSTOM_AGENTS_FLAG } },
        create: {
          scope: p.id,
          tenantId: p.id,
          key: CUSTOM_AGENTS_FLAG,
          enabled: true,
          config: { agentIds: p.agentIds, enabledBy: 'seed-custom-agents-flag', enabledAt: now },
        },
        update: {},
      })
      await tx.auditLog.create({
        data: {
          tenantId: p.id,
          action: 'UPDATE',
          entityType: 'TenantFeatureFlag',
          entityId: row.id,
          entityName: CUSTOM_AGENTS_FLAG,
          newValues: { enabled: true, agentIds: p.agentIds },
          reason: `Seed antes del switch de soporte: ${p.reasons.join('; ')}`,
          userName: 'seed-custom-agents-flag',
          userRole: 'SYSTEM',
        },
      })
    })
    console.log(`  ✓ ${p.name}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
