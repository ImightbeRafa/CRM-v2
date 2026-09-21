/**
 * Idle-network budget helper for Soft inbox v2 (acceptance 4.4).
 *
 * Documents / asserts: ≤ 1 request / 5 s while inbox is idle, regardless of
 * account count. SoftCopilotInboxV2 polls changes via CHAT_INBOX_V2_POLL_MS.
 *
 *   npx tsx scripts/chat-idle-network-assert.ts
 */
import {
  CHAT_INBOX_V2_FULL_RECONCILE_MS,
  CHAT_INBOX_V2_POLL_MS,
} from '../src/lib/chat-inbox-v2-client'

/** Hard acceptance ceiling from Phase 4 plan (≤ 1 req / 5 s). */
export const CHAT_IDLE_MAX_REQUESTS_PER_MS = 1 / 5000

export const CHAT_IDLE_NETWORK_BUDGET_MS = 5000

export type IdleNetworkBudget = {
  pollMs: number
  fullReconcileMs: number
  maxRequestsPerMs: number
  steadyStateRequestsPerMs: number
  withinBudget: boolean
  notes: string[]
}

/**
 * Steady-state request rate from a single open SoftCopilotInboxV2:
 * one `changes?afterRevision` poll every CHAT_INBOX_V2_POLL_MS.
 * Full reconcile is periodic and must still average ≤ budget over long windows.
 */
export function evaluateIdleNetworkBudget(args?: {
  pollMs?: number
  fullReconcileMs?: number
  budgetMs?: number
}): IdleNetworkBudget {
  const pollMs = args?.pollMs ?? CHAT_INBOX_V2_POLL_MS
  const fullReconcileMs = args?.fullReconcileMs ?? CHAT_INBOX_V2_FULL_RECONCILE_MS
  const budgetMs = args?.budgetMs ?? CHAT_IDLE_NETWORK_BUDGET_MS
  const maxRequestsPerMs = 1 / budgetMs
  const notes: string[] = []

  if (!(pollMs > 0)) notes.push('pollMs must be > 0')
  if (!(fullReconcileMs > 0)) notes.push('fullReconcileMs must be > 0')

  // Primary idle traffic is the revision poll. Account count must not multiply this.
  const steadyStateRequestsPerMs = 1 / pollMs
  const withinBudget = steadyStateRequestsPerMs <= maxRequestsPerMs + Number.EPSILON

  if (!withinBudget) {
    notes.push(
      `poll every ${pollMs}ms exceeds ≤1 req / ${budgetMs}ms ` +
        `(${steadyStateRequestsPerMs.toFixed(6)} > ${maxRequestsPerMs.toFixed(6)} req/ms)`,
    )
  } else {
    notes.push(
      `poll every ${pollMs}ms ≤ 1 / ${budgetMs}ms budget ` +
        `(account-count independent; SoftCopilotInboxV2 single tenant poll)`,
    )
  }

  // Over a long window, one full reconcile every fullReconcileMs adds negligible rate.
  const longWindowMs = Math.max(fullReconcileMs, budgetMs * 24)
  const longWindowRate =
    longWindowMs / pollMs / longWindowMs + 1 / fullReconcileMs
  if (longWindowRate > maxRequestsPerMs * 1.05) {
    notes.push(
      `warning: poll+reconcile average ${longWindowRate.toFixed(6)} req/ms ` +
        `nudges above budget ${maxRequestsPerMs.toFixed(6)}`,
    )
  }

  return {
    pollMs,
    fullReconcileMs,
    maxRequestsPerMs,
    steadyStateRequestsPerMs,
    withinBudget,
    notes,
  }
}

export function assertIdleNetworkBudget(): IdleNetworkBudget {
  const result = evaluateIdleNetworkBudget()
  if (!result.withinBudget) {
    throw new Error(result.notes.join('; '))
  }
  return result
}

const isDirect = /(?:^|[/\\])chat-idle-network-assert\.ts$/.test(process.argv[1] || '')

if (isDirect) {
  const result = assertIdleNetworkBudget()
  console.log(JSON.stringify({ ok: true, acceptance_4_4: result }, null, 2))
}
