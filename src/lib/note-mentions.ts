/**
 * @mentions in internal notes (Phase 2b), shared by the notes panel and tests. Mentions are read
 * from the TEXT at save time: "@Ana" present → Ana is mentioned; deleting it removes the mention.
 * The server re-filters ids to chat members of the business (workspace-notifications.ts).
 */
export type Teammate = { id: string; name: string }

/** The `@query` being typed right before the caret, or null. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const m = /(^|\s)@([\p{L}\p{N}_.-]{0,30})$/u.exec(before)
  if (!m) return null
  return { start: before.length - m[2].length - 1, query: m[2] }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function matchTeammates(teammates: Teammate[], query: string, excludeId?: string | null, limit = 6): Teammate[] {
  const q = fold(query)
  return teammates
    .filter((t) => t.id !== excludeId && (!q || fold(t.name).split(/\s+/).some((w) => w.startsWith(q)) || fold(t.name).startsWith(q)))
    .slice(0, limit)
}

/** Replace the `@query` at `start` with `@Name ` and return the new text + caret. */
export function insertMention(text: string, start: number, caret: number, teammate: Teammate): { text: string; caret: number } {
  const token = `@${teammate.name} `
  const next = text.slice(0, start) + token + text.slice(caret)
  return { text: next, caret: start + token.length }
}

/** Ids of teammates whose "@Name" appears in the text (longest names first: "Ana María" before "Ana"). */
export function mentionIdsFromText(text: string, teammates: Teammate[], excludeId?: string | null): string[] {
  const ids: string[] = []
  let rest = text
  for (const t of [...teammates].sort((a, b) => b.name.length - a.name.length)) {
    if (t.id === excludeId || !t.name) continue
    const token = `@${t.name}`
    const at = rest.indexOf(token)
    if (at === -1) continue
    const after = rest.charAt(at + token.length)
    if (after && /[\p{L}\p{N}]/u.test(after)) continue
    ids.push(t.id)
    rest = rest.slice(0, at) + ' '.repeat(token.length) + rest.slice(at + token.length)
    if (ids.length >= 10) break
  }
  return ids
}
