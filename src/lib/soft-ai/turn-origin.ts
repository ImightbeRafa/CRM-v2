/**
 * Who wrote a turn's text: code (a keyword saved reply / a system message decided before the model) or the agent.
 * Used where the turn row is all we have — the lease-reclaim send (agent-turn.ts, N8) and "Corregir" on messages sent
 * before metadata.replyBy existed (agent-tuning.ts, V11).
 *
 * Signal: the turn used a shortcut that code sends as-is (a reserved sys_* reply, or a row in "verbatim" mode) AND no
 * model tokens were spent. 'sys_purchase_summary' is appended to model answers, so it never counts on its own.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isReservedShortcutKey } from '@/lib/soft-ai/shortcuts'

export type TurnOriginRow = { shortcutKey: string | null; inputTokens: number | null; outputTokens: number | null }

/** Pure part: true / false when the row alone decides, null when the shortcut's delivery mode must be looked up. */
export function turnOriginFromRow(turn: TurnOriginRow): boolean | null {
  const key = turn.shortcutKey
  if (!key || key === 'sys_purchase_summary') return false
  if ((turn.inputTokens ?? 0) > 0 || (turn.outputTokens ?? 0) > 0) return false
  if (isReservedShortcutKey(key) || key.startsWith('sys_')) return true
  return null
}

export async function turnWasCodeDecided(tenantId: string, agentId: string, turn: TurnOriginRow): Promise<boolean> {
  const fromRow = turnOriginFromRow(turn)
  if (fromRow !== null) return fromRow
  const row = await prisma.chatAgentShortcut
    .findFirst({ where: { tenantId, agentId, key: turn.shortcutKey as string }, select: { deliveryMode: true } })
    .catch(() => null)
  return row?.deliveryMode === 'verbatim'
}
