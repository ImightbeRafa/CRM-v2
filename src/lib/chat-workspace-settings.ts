/**
 * Per-business chat workspace settings (036 ChatWorkspaceSettings): assignment rules, business
 * hours, auto-close. Missing row = defaults (everything off). Tolerates 036 not being applied.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { recordActivity } from '@/lib/activity'
import { filterChatMembers } from '@/lib/workspace-notifications'
import {
  DEFAULT_WORKSPACE_SETTINGS,
  parseAssignmentMode,
  type BusinessHours,
  type WorkspaceSettingsInput,
} from '@/lib/chat-assignment-rules'

let tableMissingUntil = 0
function markMissing(error: unknown): boolean {
  if (!isMissingRelation(error)) return false
  tableMissingUntil = Date.now() + 5 * 60_000
  return true
}
export function workspaceSettingsKnownMissing(): boolean {
  return Date.now() < tableMissingUntil
}

export type StoredWorkspaceSettings = WorkspaceSettingsInput & {
  assignmentEnabledAt: Date | null
  rrCursorUserId: string | null
  version: number
}

type Row = {
  assignmentMode: string
  assigneeUserIds: string[]
  skipAiActive: boolean
  assignmentEnabledAt: Date | null
  rrCursorUserId: string | null
  businessHours: unknown
  timezone: string
  autoCloseDays: number | null
  autoCloseStageKey: string | null
  reopenOnInbound: boolean
  version: number
}

export function rowToSettings(row: Row): StoredWorkspaceSettings {
  return {
    assignmentMode: parseAssignmentMode(row.assignmentMode) ?? 'off',
    assigneeUserIds: row.assigneeUserIds ?? [],
    skipAiActive: row.skipAiActive,
    businessHours: (row.businessHours && typeof row.businessHours === 'object' ? row.businessHours : {}) as BusinessHours,
    timezone: row.timezone || 'America/Costa_Rica',
    autoCloseDays: row.autoCloseDays,
    autoCloseStageKey: row.autoCloseStageKey,
    reopenOnInbound: row.reopenOnInbound,
    assignmentEnabledAt: row.assignmentEnabledAt,
    rrCursorUserId: row.rrCursorUserId,
    version: row.version,
  }
}

export async function loadWorkspaceSettings(tenantId: string): Promise<{ available: boolean; settings: StoredWorkspaceSettings }> {
  const defaults: StoredWorkspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS, assignmentEnabledAt: null, rrCursorUserId: null, version: 0 }
  if (workspaceSettingsKnownMissing()) return { available: false, settings: defaults }
  try {
    const row = await prisma.chatWorkspaceSettings.findUnique({ where: { tenantId } })
    return { available: true, settings: row ? rowToSettings(row) : defaults }
  } catch (error) {
    if (markMissing(error)) return { available: false, settings: defaults }
    throw error
  }
}

export async function saveWorkspaceSettings(
  tenantId: string,
  userId: string,
  input: WorkspaceSettingsInput,
): Promise<{ ok: true; settings: StoredWorkspaceSettings } | { ok: false; status: number; error: string }> {
  if (workspaceSettingsKnownMissing()) return { ok: false, status: 503, error: 'Esta configuración aún no está disponible.' }
  // Only teammates of THIS business who can work chats receive chats.
  const members = await filterChatMembers(tenantId, input.assigneeUserIds)
  if (input.assignmentMode !== 'off' && members.length === 0) {
    return { ok: false, status: 400, error: 'Ninguna de las personas elegidas puede atender chats.' }
  }
  try {
    const prev = await prisma.chatWorkspaceSettings.findUnique({ where: { tenantId }, select: { assignmentMode: true, assignmentEnabledAt: true } })
    const wasOn = Boolean(prev && prev.assignmentMode !== 'off')
    const isOn = input.assignmentMode !== 'off'
    // Turning rules on never touches the backlog: only chats whose customer writes after this.
    const assignmentEnabledAt = isOn ? (wasOn && prev?.assignmentEnabledAt ? prev.assignmentEnabledAt : new Date()) : null
    const data = {
      assignmentMode: input.assignmentMode,
      assigneeUserIds: members,
      skipAiActive: input.skipAiActive,
      assignmentEnabledAt,
      businessHours: input.businessHours as object,
      timezone: input.timezone,
      autoCloseDays: input.autoCloseDays,
      autoCloseStageKey: input.autoCloseStageKey,
      reopenOnInbound: input.reopenOnInbound,
      updatedByUserId: userId,
    }
    const row = await prisma.chatWorkspaceSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: { ...data, version: { increment: 1 } },
    })
    void recordActivity({
      tenantId,
      actorUserId: userId,
      verb: 'config.chat_workspace.set',
      entityType: 'ChatWorkspaceSettings',
      entityId: tenantId,
      surface: 'config',
      props: { mode: input.assignmentMode, people: members.length, autoCloseDays: input.autoCloseDays ?? 0, reopen: input.reopenOnInbound },
    })
    return { ok: true, settings: rowToSettings(row) }
  } catch (error) {
    if (markMissing(error)) return { ok: false, status: 503, error: 'Esta configuración aún no está disponible.' }
    throw error
  }
}
