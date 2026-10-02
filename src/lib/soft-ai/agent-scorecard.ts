/**
 * Agent scorecard (pure): turn raw per-version counts into rates, and build version snapshots.
 * "Is this agent getting better" = compare these rates between versions.
 */
import { createHash } from 'crypto'
import { SOFT_AI_PROMPT_CODE_VERSION } from '@/lib/soft-ai/agent-types'

export type ScorecardCounts = {
  agentId: string
  agentVersion: number
  model: string | null
  turns: number
  delivered: number
  suggested: number
  fallback: number
  failed: number
  /** Delivered agent messages followed by a human reply in the same chat within 30 min. */
  takeoverAfterSend: number
  attendedConversations: number
  /** Attended chats whose client placed an order within 7 days after an agent turn. */
  convertedConversations: number
  suggestionsAccepted: number
  suggestionsEdited: number
  suggestionsDismissed: number
  thumbsUp: number
  thumbsDown: number
}

export type ScorecardRow = ScorecardCounts & {
  fallbackRate: number
  takeoverRate: number
  suggestionAcceptRate: number | null
  thumbsDownRate: number | null
  conversionRate: number
}

export function emptyCounts(agentId: string, agentVersion: number): ScorecardCounts {
  return {
    agentId,
    agentVersion,
    model: null,
    turns: 0,
    delivered: 0,
    suggested: 0,
    fallback: 0,
    failed: 0,
    takeoverAfterSend: 0,
    attendedConversations: 0,
    convertedConversations: 0,
    suggestionsAccepted: 0,
    suggestionsEdited: 0,
    suggestionsDismissed: 0,
    thumbsUp: 0,
    thumbsDown: 0,
  }
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : 0)

export function toScorecardRow(c: ScorecardCounts): ScorecardRow {
  const attempted = c.delivered + c.suggested + c.fallback + c.failed
  const acted = c.suggestionsAccepted + c.suggestionsEdited + c.suggestionsDismissed
  const rated = c.thumbsUp + c.thumbsDown
  return {
    ...c,
    fallbackRate: ratio(c.fallback, attempted),
    takeoverRate: ratio(c.takeoverAfterSend, c.delivered),
    suggestionAcceptRate: acted > 0 ? (c.suggestionsAccepted + c.suggestionsEdited) / acted : null,
    thumbsDownRate: rated > 0 ? c.thumbsDown / rated : null,
    conversionRate: ratio(c.convertedConversations, c.attendedConversations),
  }
}

/** Merge several partial result sets (one per query) into rows keyed by agent + version. */
export function mergeScorecardParts(
  parts: Array<Array<Partial<ScorecardCounts> & { agentId: string; agentVersion: number }>>,
): ScorecardRow[] {
  const map = new Map<string, ScorecardCounts>()
  for (const part of parts) {
    for (const item of part) {
      const key = `${item.agentId}:${item.agentVersion}`
      const entry = map.get(key) ?? emptyCounts(item.agentId, item.agentVersion)
      for (const [k, v] of Object.entries(item)) {
        if (k === 'agentId' || k === 'agentVersion') continue
        if (k === 'model') {
          if (typeof v === 'string' && !entry.model) entry.model = v
        } else if (typeof v === 'number') {
          const bag = entry as unknown as Record<string, number>
          bag[k] = (bag[k] ?? 0) + v
        }
      }
      map.set(key, entry)
    }
  }
  return [...map.values()]
    .map(toScorecardRow)
    .sort((a, b) =>
      a.agentId === b.agentId ? b.agentVersion - a.agentVersion : a.agentId < b.agentId ? -1 : 1,
    )
}

export type VersionSnapshotSource = {
  name: string
  emoji?: string | null
  description?: string | null
  systemInstructions: string
  tonePreset: string
  model: string
  operationMode: string
  enabledTools: readonly string[]
  paymentAlwaysHuman: boolean
  status: string
  brandFacts?: unknown
  replyStyle?: unknown
  introductionNames?: unknown
}

/** Everything that can change what the agent says. Stable key order so the hash is reproducible. */
export function buildVersionSnapshot(agent: VersionSnapshotSource) {
  return {
    name: agent.name,
    emoji: agent.emoji ?? null,
    description: agent.description ?? null,
    systemInstructions: agent.systemInstructions,
    tonePreset: agent.tonePreset,
    model: agent.model,
    operationMode: agent.operationMode,
    enabledTools: [...agent.enabledTools].sort(),
    paymentAlwaysHuman: agent.paymentAlwaysHuman,
    status: agent.status,
    brandFacts: agent.brandFacts ?? null,
    replyStyle: agent.replyStyle ?? null,
    introductionNames: agent.introductionNames ?? null,
    promptCodeVersion: SOFT_AI_PROMPT_CODE_VERSION,
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    )
  }
  return value
}

export function hashSnapshot(snapshot: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(snapshot)), 'utf8').digest('hex')
}

export const FEEDBACK_REASONS = ['wrong_fact', 'wrong_tone', 'should_have_escalated', 'other'] as const
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]

export function parseFeedbackInput(body: unknown):
  | { ok: true; turnId: string; rating: 1 | -1; reasonCode: FeedbackReason | null; note: string | null }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'JSON requerido' }
  const b = body as Record<string, unknown>
  const turnId = typeof b.turnId === 'string' ? b.turnId.trim() : ''
  if (!turnId || turnId.length > 80) return { ok: false, error: 'Falta el turno' }
  const rating = b.rating === 1 ? 1 : b.rating === -1 ? -1 : null
  if (rating === null) return { ok: false, error: 'Calificación inválida' }
  let reasonCode: FeedbackReason | null = null
  if (b.reasonCode !== undefined && b.reasonCode !== null && b.reasonCode !== '') {
    if (!(FEEDBACK_REASONS as readonly unknown[]).includes(b.reasonCode)) {
      return { ok: false, error: 'Motivo inválido' }
    }
    reasonCode = b.reasonCode as FeedbackReason
  }
  if (rating === 1) reasonCode = null
  // Free-text notes are not accepted until there is a UI and a retention rule for them.
  return { ok: true, turnId, rating, reasonCode, note: null }
}
