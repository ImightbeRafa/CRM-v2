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
/** No further part starts after this (turn budget 35 s, job lease 45 s; the first message always goes). */
export const AGENT_PARTS_DEADLINE_MS = 33_000

export type ReplyPartPlan = { index: number; text: string; deliveryKey: string; contentHash: string }

/**
 * Live send: one exactly-once claim per message of a reply. Part 0 keeps the turn's own delivery key and content
 * hash (a re-run with a different text still conflicts there, before anything else goes out); part i ≥ 1 uses
 * `${deliveryKey}:p${i}` with the hash of its own text. Pure (`hash` = hashSoftAiDeliveryContent).
 */
export function planReplyParts(input: {
  text: string
  deliveryKey: string
  contentHash: string
  hash: (text: string) => string
}): ReplyPartPlan[] {
  const parts = splitReplyParts(input.text)
  const list = parts.length ? parts : [input.text]
  return list.map((text, index) =>
    index === 0
      ? { index, text, deliveryKey: input.deliveryKey, contentHash: input.contentHash }
      : { index, text, deliveryKey: `${input.deliveryKey}:p${index}`, contentHash: input.hash(text) },
  )
}

/**
 * Corregir in a real chat: the parts of one agent reply (same turn), joined back in partIndex order with a blank
 * line. Only this agent's AI messages count; a duplicate part (re-run dual write) is taken once.
 */
export function joinReplyParts(rows: Array<{ content: string; metadata: Record<string, unknown> }>, agentId: string): string {
  const byIndex = new Map<number, string>()
  for (const row of rows) {
    const m = row.metadata
    if (m.softAi !== true || m.agentId !== agentId) continue
    const index = typeof m.partIndex === 'number' && Number.isInteger(m.partIndex) ? m.partIndex : 0
    if (!byIndex.has(index) && row.content.trim()) byIndex.set(index, row.content.trim())
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
