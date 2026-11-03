/**
 * Revert DeepSleep conversion data apply (2026-11-03) from a backup JSON file.
 *
 * CRM161-01/02: refuses to run without --backup=<path> (or the newest file in --backup-dir).
 * Restores ChatAgent instructions + brandFacts, every ChatAgentShortcut row, knowledge bindings
 * (re-binds the pre-apply docs; unbinds apply-added FAQ titles), and the RAW agent_follow_up_v1
 * config + enabled bit — never sets other campaigns active:false.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-conversion-revert.ts \
 *     --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     --backup=scripts/agent-pack/out/deepsleep-conversion-backup-….json \
 *     [--dry-run] [--apply] [--agent=forge|prototipo|pura|sleeping|all] \
 *     [--version=N] [--actor-email=rafael@betsycrm.com]
 *
 * --disable-follow-ups is accepted as an alias that restores the RAW follow-up flag from the backup
 * (enabled + config verbatim). It does NOT invent active:false on other campaigns.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { listShortcuts, updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { bindKnowledgeToAgent, unbindKnowledgeFromAgent } from '@/lib/soft-ai/knowledge-admin'
import { FOLLOW_UP_FLAG } from '@/lib/soft-ai/follow-up'
import { ConversionBackupV1 } from '@/lib/soft-ai/deepsleep-conversion-pack'
import {
  DEEPSLEEP_AGENTS,
  DEEPSLEEP_OWNER_EMAIL,
  DEEPSLEEP_TENANT_ID,
  DEEPSLEEP_TENANT_SLUG,
} from '../lib/deepsleep-conversion-ids'

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY || process.argv.includes('--dry-run')
const RESTORE_FOLLOW_UPS =
  process.argv.includes('--disable-follow-ups') || process.argv.includes('--restore-follow-ups')
const TENANT_ID = DEEPSLEEP_TENANT_ID

const AGENTS: Record<string, string> = {
  forge: DEEPSLEEP_AGENTS.forge,
  sleeping: DEEPSLEEP_AGENTS.sleeping,
  pura: DEEPSLEEP_AGENTS.pura,
  prototipo: DEEPSLEEP_AGENTS.prototipo,
}

/** FAQ titles introduced by the apply script — unbound after restoring pre-apply bindings. */
const NEW_FAQ_NAMES = [
  'FAQ — dolor de espalda (sin claims médicos)',
  'FAQ — cómo pagar / pedir / envío / lavado / mayoreo',
  'FAQ — color (solo negro)',
  'FAQ — cambio de talla',
]

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function dbHost(): string {
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL || ''
  try {
    return new URL(url).host || '(unparseable DATABASE_URL)'
  } catch {
    return url ? '(unparseable DATABASE_URL)' : '(no DATABASE_URL)'
  }
}

function requireConfirmTenant(slug: string) {
  const confirm = arg('confirm-tenant')
  if (!confirm) {
    throw new Error('Refusing: pass --confirm-tenant=<slug> (e.g. --confirm-tenant=deepsleepp-cr-1762740734630)')
  }
  if (confirm !== slug) {
    throw new Error(`Refusing: --confirm-tenant=${confirm} does not match live slug ${slug}`)
  }
}

function parseVersionArg(): number | null {
  const raw = arg('version')
  if (raw == null) return null
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid --version=${raw}: must be a non-negative integer`)
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --version=${raw}: must be a non-negative integer`)
  }
  return n
}

function resolveBackupPath(): string {
  const explicit = arg('backup')
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Backup file not found: ${explicit}`)
    return explicit
  }
  const dir = arg('backup-dir') || join(process.cwd(), 'scripts/agent-pack/out')
  if (!existsSync(dir)) {
    throw new Error(
      `Refusing: no --backup=… and backup dir missing (${dir}). Apply first (writes a timestamped JSON), then revert with --backup=<path>.`,
    )
  }
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('deepsleep-conversion-backup-') && f.endsWith('.json'))
    .sort()
  if (!files.length) {
    throw new Error(`Refusing: no deepsleep-conversion-backup-*.json in ${dir}. Pass --backup=<path>.`)
  }
  return join(dir, files[files.length - 1]!)
}

function loadBackup(path: string): ConversionBackupV1 {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ConversionBackupV1
  if (raw?.version !== 1 || !raw.agents || typeof raw.agents !== 'object') {
    throw new Error(`Backup ${path} is not a ConversionBackupV1`)
  }
  if (raw.tenantId !== TENANT_ID) {
    throw new Error(`Backup tenantId ${raw.tenantId} != ${TENANT_ID}`)
  }
  return raw
}

async function resolveActor() {
  const email = (arg('actor-email') || DEEPSLEEP_OWNER_EMAIL).trim().toLowerCase()
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, email: true },
  })
  if (!user?.email || user.email.toLowerCase() !== email) {
    throw new Error(`No user with exact email ${email}`)
  }
  const member = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      tenantId: TENANT_ID,
      isActive: true,
      role: { in: ['OWNER', 'ADMIN'] },
    },
    select: { role: true },
  })
  if (!member) {
    throw new Error(`User ${email} has no active OWNER/ADMIN membership on DeepSleep`)
  }
  return {
    actorUserId: user.id,
    actorName: `${user.name || user.email} (deepsleep-conversion-revert)`,
    actorRole: String(member.role),
  }
}

async function restoreAgent(
  agentId: string,
  label: string,
  backup: ConversionBackupV1,
  versionPin: number | null,
  act: Awaited<ReturnType<typeof resolveActor>>,
) {
  const snap = backup.agents[agentId]
  if (!snap) {
    console.log(`! ${label}: not in backup`)
    return
  }
  if (versionPin != null && snap.version !== versionPin) {
    console.log(
      `! ${label}: backup agent version is ${snap.version}, --version=${versionPin} does not match — refusing this agent`,
    )
    return
  }
  console.log(`~ ${label}: restore from backup (pre-apply v${snap.version})`)

  if (!DRY) {
    await updateChatAgent({
      tenantId: TENANT_ID,
      agentId,
      ...act,
      patch: {
        systemInstructions: snap.systemInstructions ?? '',
        ...(snap.brandFacts !== undefined ? { brandFacts: snap.brandFacts as object } : {}),
      },
    })
  } else {
    console.log(`  instructions: ${String(snap.systemInstructions || '').slice(0, 80)}…`)
  }

  const { shortcuts: live } = await listShortcuts(TENANT_ID, agentId)
  for (const want of snap.shortcuts) {
    const key = String(want.key || '')
    const row = live.find((x) => x.key === key)
    if (!row) {
      console.log(`  ! shortcut ${key} missing live — skip`)
      continue
    }
    console.log(`  shortcut ${key}`)
    if (!DRY) {
      await updateShortcut({
        tenantId: TENANT_ID,
        agentId,
        shortcutId: row.id,
        ...act,
        patch: {
          ...(Array.isArray(want.keywords) ? { keywords: want.keywords as string[] } : {}),
          ...(typeof want.body === 'string' ? { body: want.body } : {}),
        },
      })
    }
  }

  // Unbind apply-added FAQ titles, then re-bind every pre-apply sourceId from the backup.
  const applyDocs = await prisma.chatKnowledgeSource.findMany({
    where: { tenantId: TENANT_ID, name: { in: NEW_FAQ_NAMES } },
    select: { id: true, name: true },
  })
  for (const d of applyDocs) {
    console.log(`  unbind apply knowledge "${d.name}"`)
    if (!DRY) {
      await unbindKnowledgeFromAgent({
        tenantId: TENANT_ID,
        agentId,
        sourceId: d.id,
        ...act,
      }).catch(() => null)
    }
  }
  for (const b of snap.knowledgeBindings) {
    console.log(`  re-bind knowledge ${b.name || b.sourceId}`)
    if (!DRY) {
      await bindKnowledgeToAgent({
        tenantId: TENANT_ID,
        agentId,
        sourceId: b.sourceId,
        ...act,
      }).catch((e) => console.log(`    ! bind failed: ${String(e)}`))
    }
  }
}

async function restoreFollowUps(backup: ConversionBackupV1) {
  if (!RESTORE_FOLLOW_UPS && !APPLY) {
    // dry-run without the flag still shows intent when backup has a flag
  }
  if (!backup.followUpFlag) {
    console.log('! backup has no follow-up flag row — skip FU restore')
    return
  }
  const live = await prisma.tenantFeatureFlag.findFirst({
    where: { id: backup.followUpFlag.id, key: FOLLOW_UP_FLAG },
    select: { id: true },
  })
  if (!live) {
    console.log(`! follow-up flag id ${backup.followUpFlag.id} missing live`)
    return
  }
  console.log(
    `~ restore RAW agent_follow_up_v1 from backup (enabled=${backup.followUpFlag.enabled}; no active:false invent)`,
  )
  if (!DRY) {
    await prisma.tenantFeatureFlag.update({
      where: { id: backup.followUpFlag.id },
      data: {
        enabled: backup.followUpFlag.enabled,
        config: backup.followUpFlag.config as object,
        updatedAt: new Date(),
      },
    })
  }
}

async function main() {
  console.log(`DeepSleep conversion revert — ${DRY ? 'DRY-RUN' : 'APPLY'}`)
  console.log(`DB host: ${dbHost()}`)
  const versionPin = parseVersionArg()
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, slug: true, name: true },
  })
  if (!tenant || tenant.slug !== DEEPSLEEP_TENANT_SLUG) {
    throw new Error(`Refusing: tenant slug ${tenant?.slug} != ${DEEPSLEEP_TENANT_SLUG}`)
  }
  console.log(`Tenant: ${tenant.name} (${tenant.slug} / ${tenant.id})`)
  requireConfirmTenant(tenant.slug)

  const backupPath = resolveBackupPath()
  const backup = loadBackup(backupPath)
  console.log(`Backup: ${backupPath} (created ${backup.createdAt})`)

  const act = await resolveActor()
  console.log(`Actor: ${act.actorName} role=${act.actorRole}`)

  const which = arg('agent') || 'all'
  const ids =
    which === 'all' ? Object.entries(AGENTS) : Object.entries(AGENTS).filter(([k]) => k === which)
  if (!ids.length) throw new Error(`Unknown --agent=${which}`)

  for (const [label, id] of ids) {
    await restoreAgent(id, label, backup, versionPin, act)
  }

  // Always restore FU from backup when --disable-follow-ups / --restore-follow-ups, or when applying a full revert.
  if (RESTORE_FOLLOW_UPS || (APPLY && which === 'all')) {
    await restoreFollowUps(backup)
  } else {
    console.log('Follow-ups: skipped (pass --disable-follow-ups / --restore-follow-ups to restore RAW flag from backup)')
  }

  console.log(`Done (${DRY ? 'dry-run — re-run with --apply' : 'applied'}).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
