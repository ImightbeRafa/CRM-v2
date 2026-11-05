/**
 * DeepSleep only: turn the first-reply greeting (#164) and the size-guide image (#165) flags on — or off.
 *
 * Flags are PER TENANT: TenantFeatureFlag rows with scope = tenantId (unique scope+key), read by
 * isTenantFeatureEnabled / loadSizeGuideKey with `where: { tenantId, scope: tenantId, key }`. No global row exists or
 * is read for these keys, so a DeepSleep row cannot turn anything on for another tenant. This script only ever reads
 * or writes rows where scope = tenantId = DeepSleep.
 *
 *   agent_first_greeting_v1  enabled, config null
 *   agent_size_guide_v1      enabled, config {"agents":{"<Forge>":"fg_tallas"}}  (Forge's guide saved reply + image)
 *
 * Default dry-run. --apply writes, after a backup JSON (rows before/after) under scripts/agent-pack/out/ (gitignored)
 * or --backup-dir. --off: quick rollback, both flags enabled=false (config kept; same effect as no row).
 * --restore=<backup.json>: put the rows back exactly as backed up (a row that did not exist is deleted).
 * Idempotent: a re-run after --apply shows 0 changes. Requires --confirm-tenant=<DeepSleep slug>.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-agent-flags.ts --confirm-tenant=deepsleepp-cr-1762740734630 [--apply] [--off | --restore=<json>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { DEEPSLEEP_AGENTS, DEEPSLEEP_TENANT_ID, DEEPSLEEP_TENANT_SLUG } from '../lib/deepsleep-conversion-ids'
import { resolveRepoOutPath } from '../lib/out-path-guard'

const APPLY = process.argv.includes('--apply')
const OFF = process.argv.includes('--off')
const TENANT_ID = DEEPSLEEP_TENANT_ID
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const RESTORE = arg('restore')

/** Keys as defined in src/lib/soft-ai/first-greeting.ts and size-guide.ts (kept literal: brand ids live in scripts/). */
export const GREETING_FLAG = 'agent_first_greeting_v1'
export const SIZE_GUIDE_FLAG = 'agent_size_guide_v1'
const GUIDE_KEY = 'fg_tallas'

type FlagState = { enabled: boolean; config: unknown } | null
type Row = { id: string; scope: string; tenantId: string | null; key: string; enabled: boolean; config: unknown }
type Backup = { version: 1; kind: 'deepsleep-agent-flags'; createdAt: string; tenantId: string; mode: string; rows: Array<{ key: string; before: Row | null; after: FlagState }> }

const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object'
    ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
    : JSON.stringify(v ?? null)
const same = (a: FlagState, b: FlagState) => stable(a) === stable(b)

async function desired(): Promise<Record<string, FlagState>> {
  if (RESTORE) {
    const b = JSON.parse(readFileSync(RESTORE, 'utf8')) as Backup
    if (b.kind !== 'deepsleep-agent-flags' || b.tenantId !== TENANT_ID) throw new Error('Refusing: not a deepsleep-agent-flags backup for this tenant')
    return Object.fromEntries(b.rows.map((r) => [r.key, r.before ? { enabled: r.before.enabled, config: r.before.config ?? null } : null]))
  }
  const guideConfig = { agents: { [DEEPSLEEP_AGENTS.forge]: GUIDE_KEY } }
  return {
    [GREETING_FLAG]: { enabled: !OFF, config: null },
    [SIZE_GUIDE_FLAG]: { enabled: !OFF, config: guideConfig },
  }
}

async function main() {
  const mode = RESTORE ? `RESTORE ${RESTORE}` : OFF ? 'OFF' : 'ON'
  console.log(`DeepSleep agent flags — ${APPLY ? 'APPLY' : 'DRY-RUN'} (${mode})`)
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true, slug: true, name: true } })
  if (!tenant || tenant.slug !== DEEPSLEEP_TENANT_SLUG) throw new Error(`Refusing: tenant ${TENANT_ID} slug is ${tenant?.slug}`)
  const confirm = arg('confirm-tenant')
  if (confirm !== tenant.slug) throw new Error(`Refusing: pass --confirm-tenant=${tenant.slug} (got ${confirm ?? 'nothing'})`)
  console.log(`Tenant: ${tenant.name} (${tenant.slug} / ${tenant.id})`)

  const want = await desired()
  const errors: string[] = []
  const plan: Backup['rows'] = []
  for (const [key, after] of Object.entries(want)) {
    const rows = (await prisma.tenantFeatureFlag.findMany({ where: { scope: TENANT_ID, key } })) as Row[]
    if (rows.length > 1) errors.push(`${key}: ${rows.length} rows for this scope`)
    const before = rows[0] ?? null
    if (before && before.tenantId !== TENANT_ID) errors.push(`${key}: row ${before.id} has tenantId ${before.tenantId}`)
    const now: FlagState = before ? { enabled: before.enabled, config: before.config ?? null } : null
    const same0 = same(now, after) || (!now && after && !after.enabled && !RESTORE) // OFF with no row = already off
    console.log(`  ${same0 ? '=' : '~'} ${key}: ${JSON.stringify(now)} → ${JSON.stringify(after)}${same0 ? ' (unchanged)' : ''}`)
    if (!same0) plan.push({ key, before, after })
  }

  // The guide flag only works if Forge's fg_tallas saved reply exists, is on and has an active image.
  const guide = want[SIZE_GUIDE_FLAG]
  if (guide?.enabled) {
    const agentId = DEEPSLEEP_AGENTS.forge
    const sc = await prisma.chatAgentShortcut.findFirst({ where: { tenantId: TENANT_ID, agentId, key: GUIDE_KEY }, select: { id: true, isActive: true } })
    if (!sc) errors.push(`${GUIDE_KEY}: saved reply not found on Forge`)
    else {
      if (!sc.isActive) errors.push(`${GUIDE_KEY}: saved reply is off`)
      const imgs = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
        SELECT COUNT(*) AS "n" FROM "ChatAgentShortcutAsset" sa
          JOIN "ChatAgentAsset" a ON a."id" = sa."assetId" AND a."tenantId" = sa."tenantId"
         WHERE sa."tenantId" = ${TENANT_ID} AND sa."shortcutId" = ${sc.id} AND a."status" = 'active'
           AND (a."agentId" = ${agentId} OR a."agentId" IS NULL)`
      const n = Number(imgs[0]?.n ?? 0)
      if (!n) errors.push(`${GUIDE_KEY}: no active image linked`)
      else console.log(`  ✓ ${GUIDE_KEY} on Forge: on, ${n} active image(s)`)
    }
  }

  console.log(`\nPlanned: ${plan.length} change(s)`)
  if (errors.length) {
    console.log(`✗ ${errors.length} error(s) — nothing written:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
    process.exitCode = 1
    return
  }
  if (!APPLY || !plan.length) {
    console.log(APPLY ? 'Nothing to do.' : 'DRY-RUN: nothing written. Re-run with --apply.')
    return
  }
  const dir = resolveRepoOutPath(arg('backup-dir') || join(process.cwd(), 'scripts/agent-pack/out'), '--backup-dir')
  mkdirSync(dir, { recursive: true })
  const createdAt = new Date().toISOString()
  const backup: Backup = { version: 1, kind: 'deepsleep-agent-flags', createdAt, tenantId: TENANT_ID, mode, rows: plan }
  const path = join(dir, `deepsleep-agent-flags-backup-${createdAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(path, JSON.stringify(backup, null, 2))
  console.log(`Backup: ${path}`)
  for (const { key, after } of plan) {
    if (after === null) {
      await prisma.tenantFeatureFlag.deleteMany({ where: { scope: TENANT_ID, tenantId: TENANT_ID, key } })
    } else {
      // Review 2026-11-04: a null config is written as SQL NULL (exact restore), not skipped.
      const config = after.config == null ? Prisma.DbNull : (after.config as Prisma.InputJsonValue)
      await prisma.tenantFeatureFlag.upsert({
        where: { scope_key: { scope: TENANT_ID, key } },
        create: { scope: TENANT_ID, tenantId: TENANT_ID, key, enabled: after.enabled, config },
        update: { enabled: after.enabled, config },
      })
    }
    console.log(`  ✓ ${key}`)
  }
  console.log(`\nDone. Off: --off --apply · exact restore: --restore=${path} --apply`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
