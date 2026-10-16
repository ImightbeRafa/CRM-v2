/**
 * agents2-format (Rafael 2026-10-16): an agent reply goes out as separate WhatsApp / Instagram messages, one per
 * paragraph (blank line), at most MAX_REPLY_PARTS. Pure and client-safe (live send loop, Probar bubbles, Corregir).
 */

/** Most messages one reply may become. */
export const MAX_REPLY_PARTS = 3

/**
 * Split a reply at blank lines; extra paragraphs are merged into the last part. Single line breaks stay inside a
 * message (lists, a payment block). Never changes the words.
 */
export function splitReplyParts(text: string, maxParts = MAX_REPLY_PARTS): string[] {
  const paragraphs = (text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const cap = Math.max(1, Math.floor(maxParts))
  if (paragraphs.length <= cap) return paragraphs
  return [...paragraphs.slice(0, cap - 1), paragraphs.slice(cap - 1).join('\n\n')]
}

/** Pause between the messages of one reply (reads like a person typing). */
export const REPLY_PART_GAP_MS = 700
/**
 * Past this (from the turn start; the job's processing timeout is 42 s) there are no more gaps: whatever is left of the
 * reply goes out at once as ONE last message (Verifier F2 — never silently dropped).
 */
export const AGENT_PARTS_DEADLINE_MS = 38_000

/**
 * The part-0 claim is hashed with a version: a claim made by the old single-message code for the same job conflicts
 * (SOFT_AI_OUTBOUND_CONTENT_CONFLICT) instead of letting the later parts go out after a full-text send.
 */
export const PART_HASH_VERSION = 'parts-v1|'

export type ReplyPartPlan = { index: number; text: string; deliveryKey: string; contentHash: string }

/**
 * Live send: one exactly-once claim per message of a reply. Part 0 keeps the turn's own delivery key, hashed as
 * PART_HASH_VERSION + the whole reply (a re-run with a different text conflicts there, before anything else goes out);
 * part i ≥ 1 uses `${deliveryKey}:p${i}` with the hash of its own text. Pure (`hash` = hashSoftAiDeliveryContent).
 */
export function planReplyParts(input: { text: string; deliveryKey: string; hash: (text: string) => string }): ReplyPartPlan[] {
  const parts = splitReplyParts(input.text)
  const list = parts.length ? parts : [input.text]
  return list.map((text, index) =>
    index === 0
      ? { index, text, deliveryKey: input.deliveryKey, contentHash: input.hash(`${PART_HASH_VERSION}${input.text}`) }
      : { index, text, deliveryKey: `${input.deliveryKey}:p${index}`, contentHash: input.hash(text) },
  )
}

/**
 * Late turn (F2): the parts from `index` on, joined (blank line) into ONE message under part `index`'s key, hashed on
 * the joined text (a retry that splits differently conflicts instead of resending). Pure.
 */
export function remainderPart(plan: ReplyPartPlan[], index: number, hash: (text: string) => string): ReplyPartPlan {
  if (index >= plan.length - 1) return plan[index]
  const text = plan.slice(index).map((p) => p.text).join('\n\n')
  return { index, text, deliveryKey: plan[index].deliveryKey, contentHash: hash(text) }
}

/**
 * Corregir in a real chat: the TEXT parts of one agent reply (same turn, numeric partIndex), joined back in partIndex
 * order with a blank line. Only this agent's AI messages count; images of the saved reply (same turnId) and a
 * duplicate part (re-run dual write) are left out.
 */
export function joinReplyParts(
  rows: Array<{ content: string; metadata: Record<string, unknown>; messageType?: string | null }>,
  agentId: string,
): string {
  const byIndex = new Map<number, string>()
  for (const row of rows) {
    const m = row.metadata
    if (m.softAi !== true || m.agentId !== agentId) continue
    if ((row.messageType && row.messageType !== 'text') || m.agentAssetId !== undefined || m.agentAssetSha !== undefined) continue
    if (typeof m.partIndex !== 'number' || !Number.isInteger(m.partIndex)) continue
    if (!byIndex.has(m.partIndex) && row.content.trim()) byIndex.set(m.partIndex, row.content.trim())
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('\n\n')
}

/**
 * Probar: the agent bubbles of one test turn. Uses the server's `parts` when they are valid strings, otherwise splits
 * `text` the same way the live send does.
 */
export function replyPartsOf(data: { text?: unknown; parts?: unknown }): string[] {
  if (Array.isArray(data.parts)) {
    const parts = data.parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, MAX_REPLY_PARTS)
    if (parts.length) return parts
  }
  return typeof data.text === 'string' ? splitReplyParts(data.text) : []
}
