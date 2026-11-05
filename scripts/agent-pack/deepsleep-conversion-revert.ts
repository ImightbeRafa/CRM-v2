/**
 * Revert DeepSleep conversion data apply from a backup JSON (v2 change log).
 *
 * CRM161-09: requires explicit --backup=<path> (no newest-file fallback). Before each write,
 * compares the live value to what apply wrote (`after`); on mismatch skips + warns unless --force.
 * CRM161-10: restores only the fields/rows recorded in `changes`.
 * CRM161-11: follow-up restore touches only active + stageTexts on patched campaign ids
 * (preserves claimed entries and campaigns added after apply).
 * CRM161-14: follow-up flag restore only with explicit --restore-follow-ups
 * (--disable-follow-ups remains an alias).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-conversion-revert.ts \
 *     --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     --backup=scripts/agent-pack/out/deepsleep-conversion-backup-….json \
 *     [--dry-run] [--apply] [--force] [--restore-follow-ups] \
 *     [--actor-email=rafael@betsycrm.com]
 */
import { existsSync, readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { listShortcuts, updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { approveKnowledgeSource, bindKnowledgeToAgent, unbindKnowledgeFromAgent, updateKnowledgeDraft } from '@/lib/soft-ai/knowledge-admin'
import { FOLLOW_UP_FLAG } from '@/lib/soft-ai/follow-up'
import {
  BackupChange,
  ConversionBackupV2,
  restoreRawFollowUpCampaignFields,
  sameJson,
} from '@/lib/soft-ai/deepsleep-conversion-pack'
import {
  DEEPSLEEP_OWNER_EMAIL,
  DEEPSLEEP_TENANT_ID,
  DEEPSLEEP_TENANT_SLUG,
} from '../lib/deepsleep-conversion-ids'

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY || process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const RESTORE_FOLLOW_UPS =
  process.argv.includes('--restore-follow-ups') || process.argv.includes('--disable-follow-ups')
const TENANT_ID = DEEPSLEEP_TENANT_ID

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

/** CRM161-09: explicit --backup only — never fall back to newest file in a directory. */
function resolveBackupPath(): string {
  const explicit = arg('backup')
  if (!explicit) {
    throw new Error(
      'Refusing: pass --backup=<path> to the exact JSON apply wrote. Newest-file fallback removed (CRM161-09).',
    )
  }
  if (!existsSync(explicit)) throw new Error(`Backup file not found: ${explicit}`)
  return explicit
}

function loadBackup(path: string): ConversionBackupV2 {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ConversionBackupV2
  if (raw?.version !== 2 || !Array.isArray(raw.changes)) {
    throw new Error(`Backup ${path} is not a ConversionBackupV2 (version:2 + changes[])`)
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

type Actor = Awaited<ReturnType<typeof resolveActor>>

function mismatchWarn(label: string): boolean {
  if (FORCE) {
    console.log(`  ! ${label}: live ≠ apply after — continuing (--force)`)
    return false
  }
  console.log(`  ! ${label}: live ≠ apply after — SKIP (pass --force to overwrite)`)
  return true
}

async function revertInstructions(ch: Extract<BackupChange, { kind: 'instructions' }>, act: Actor) {
  const live = await prisma.chatAgent.findFirst({
    where: { id: ch.agentId, tenantId: TENANT_ID },
    select: { systemInstructions: true },
  })
  if (!live) {
    console.log(`! instructions ${ch.agentId}: agent missing — skip`)
    return
  }
  const liveVal = live.systemInstructions ?? null
  if ((liveVal || '').trim() !== (ch.after || '').trim()) {
    if (mismatchWarn(`instructions ${ch.agentId}`)) return
  } else {
    console.log(`~ instructions ${ch.agentId}`)
  }
  if (DRY) return
  await updateChatAgent({
    tenantId: TENANT_ID,
    agentId: ch.agentId,
    ...act,
    patch: { systemInstructions: ch.before ?? '' },
  })
}

async function revertShortcut(ch: Extract<BackupChange, { kind: 'shortcut' }>, act: Actor) {
  const { shortcuts } = await listShortcuts(TENANT_ID, ch.agentId)
  const row = shortcuts.find((s) => s.id === ch.shortcutId) || shortcuts.find((s) => s.key === ch.shortcutKey)
  if (!row) {
    console.log(`! shortcut ${ch.shortcutKey}: missing live — skip`)
    return
  }
  const liveAfter = { keywords: row.keywords, body: row.body }
  if (!sameJson(liveAfter.keywords, ch.after.keywords) || liveAfter.body.trim() !== ch.after.body.trim()) {
    if (mismatchWarn(`shortcut ${ch.shortcutKey}`)) return
  } else {
    console.log(`~ shortcut ${ch.shortcutKey}`)
  }
  if (DRY) return
  await updateShortcut({
    tenantId: TENANT_ID,
    agentId: ch.agentId,
    shortcutId: row.id,
    ...act,
    patch: { keywords: ch.before.keywords, body: ch.before.body },
  })
}

async function revertKnowledge(ch: Extract<BackupChange, { kind: 'knowledge' }>, act: Actor) {
  const bound = await prisma.chatAgentKnowledgeSource.findMany({
    where: { tenantId: TENANT_ID, agentId: ch.agentId },
    select: { sourceId: true },
  })
  const liveIds = new Set(bound.map((b) => b.sourceId))
  // Compare live to what apply wrote: the afterBoundSourceId must still be bound.
  if (ch.afterBoundSourceId && !liveIds.has(ch.afterBoundSourceId)) {
    if (mismatchWarn(`knowledge "${ch.name}" (after id unbound)`)) return
  } else {
    console.log(`~ knowledge "${ch.name}"`)
  }
  if (DRY) return
  // Review 2026-11-04: approving the new version ARCHIVED the old one, so re-binding the old id failed (swallowed) and the
  // agent ended up with neither doc. Restore first — an archived old doc comes back as a NEW approved version with the
  // old body (same as the no-weight revert) — and only unbind the apply's doc once every old doc is bound again.
  for (const oldId of ch.beforeBoundSourceIds) {
    if (oldId === ch.afterBoundSourceId) continue
    const old = await prisma.chatKnowledgeSource.findFirst({
      where: { tenantId: TENANT_ID, id: oldId },
      select: { id: true, status: true, body: true },
    })
    if (!old) throw new Error(`knowledge "${ch.name}": old source ${oldId} not found — nothing unbound`)
    let restoreId = old.id
    if (old.status !== 'approved') {
      if (!ch.afterBoundSourceId) throw new Error(`knowledge "${ch.name}": old source archived and no new doc to version from`)
      const draft = await updateKnowledgeDraft({ tenantId: TENANT_ID, sourceId: ch.afterBoundSourceId, ...act, body: old.body })
      await approveKnowledgeSource({ tenantId: TENANT_ID, sourceId: draft.id, ...act })
      restoreId = draft.id
    }
    await bindKnowledgeToAgent({ tenantId: TENANT_ID, agentId: ch.agentId, sourceId: restoreId, ...act })
  }
  if (ch.afterBoundSourceId) {
    const still = await prisma.chatAgentKnowledgeSource.findFirst({
      where: { tenantId: TENANT_ID, agentId: ch.agentId, sourceId: ch.afterBoundSourceId },
      select: { sourceId: true },
    })
    if (still) {
      await unbindKnowledgeFromAgent({ tenantId: TENANT_ID, agentId: ch.agentId, sourceId: ch.afterBoundSourceId, ...act })
    }
  }
}

async function revertFollowUp(ch: Extract<BackupChange, { kind: 'follow_up' }>) {
  const live = await prisma.tenantFeatureFlag.findFirst({
    where: { id: ch.flagId, key: FOLLOW_UP_FLAG, OR: [{ scope: TENANT_ID }, { tenantId: TENANT_ID }] },
  })
  if (!live) {
    console.log(`! follow-up flag ${ch.flagId} missing — skip`)
    return
  }
  if (live.enabled !== ch.afterEnabled) {
    if (mismatchWarn(`follow-up enabled (live=${live.enabled} after=${ch.afterEnabled})`)) return
  }
  const liveCampaigns = Array.isArray((live.config as { campaigns?: unknown[] } | null)?.campaigns)
    ? ((live.config as { campaigns: Array<Record<string, unknown>> }).campaigns)
    : []
  for (const id of ch.patchedCampaignIds) {
    const row = liveCampaigns.find((c) => c.id === id)
    const expected = ch.afterByCampaignId[id]
    if (!row || !expected) continue
    const liveSlice = { active: Boolean(row.active), stageTexts: row.stageTexts }
    if (!sameJson(liveSlice.active, expected.active) || !sameJson(liveSlice.stageTexts, expected.stageTexts)) {
      if (mismatchWarn(`follow-up campaign ${id} active/stageTexts`)) return
    }
  }
  console.log(
    `~ restore follow-up flag enabled=${ch.beforeEnabled}; active+stageTexts on ${ch.patchedCampaignIds.length} campaign(s)`,
  )
  if (DRY) return
  const nextConfig = restoreRawFollowUpCampaignFields(
    live.config,
    ch.patchedCampaignIds,
    ch.beforeByCampaignId,
  )
  await prisma.tenantFeatureFlag.update({
    where: { id: ch.flagId },
    data: {
      enabled: ch.beforeEnabled,
      config: nextConfig as object,
      updatedAt: new Date(),
    },
  })
}

async function main() {
  console.log(`DeepSleep conversion revert — ${DRY ? 'DRY-RUN' : 'APPLY'}${FORCE ? ' (--force)' : ''}`)
  console.log(`DB host: ${dbHost()}`)
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
  console.log(`Backup: ${backupPath} (created ${backup.createdAt}; ${backup.changes.length} change(s))`)

  const act = await resolveActor()
  console.log(`Actor: ${act.actorName} role=${act.actorRole}`)

  let fuChanges = 0
  for (const ch of backup.changes) {
    if (ch.kind === 'instructions') {
      await revertInstructions(ch, act)
      continue
    }
    if (ch.kind === 'shortcut') {
      await revertShortcut(ch, act)
      continue
    }
    if (ch.kind === 'knowledge') {
      await revertKnowledge(ch, act)
      continue
    }
    if (ch.kind === 'follow_up') {
      fuChanges += 1
      if (!RESTORE_FOLLOW_UPS) {
        console.log(
          `= follow-up change recorded — skipped (pass --restore-follow-ups to restore enabled + active/stageTexts)`,
        )
        continue
      }
      await revertFollowUp(ch)
      continue
    }
    const _exhaustive: never = ch
    void _exhaustive
  }

  if (!fuChanges) {
    console.log('Follow-ups: no follow_up change in this backup')
  } else if (!RESTORE_FOLLOW_UPS) {
    console.log('Follow-ups: skipped (CRM161-14 — require --restore-follow-ups)')
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
