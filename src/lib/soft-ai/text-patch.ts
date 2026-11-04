/**
 * Surgical text edits for owner copy (instructions, saved replies, knowledge, selling rules): replace one exact
 * sentence and leave the rest of the live text as it is, so a data script never overwrites an inbox correction or
 * a later owner edit made somewhere else in the same text. Pure; no DB.
 *
 * Per edit, on the current text:
 *   - `from` appears exactly once → replaced by `to`            ("change")
 *   - `from` is gone and `to` is there → already applied          ("same", idempotent re-run)
 *   - anything else (missing, twice, edited by hand) → refused    ("conflict": the script stops before any write)
 */
export type TextEdit = { from: string; to: string }

export type TextEditPlan =
  | { status: 'change'; next: string }
  | { status: 'same'; next: string }
  | { status: 'conflict'; next: string; error: string }

const count = (text: string, part: string) => (part ? text.split(part).length - 1 : 0)

/** Well-formed: both sides non-empty (a deletion keeps an anchor word) and `to` does not contain `from` (re-runs stay unambiguous). */
export function textEditProblem(edit: TextEdit): string | null {
  if (!edit.from) return 'empty from'
  if (!edit.to) return 'empty to'
  if (edit.from === edit.to) return 'from equals to'
  if (edit.to.includes(edit.from)) return 'to contains from'
  return null
}

export function planTextEdits(live: string, edits: TextEdit[]): TextEditPlan {
  let next = live
  let changed = false
  for (const edit of edits) {
    const bad = textEditProblem(edit)
    if (bad) return { status: 'conflict', next: live, error: `${bad}: ${JSON.stringify(edit.from.slice(0, 60))}` }
    const hits = count(next, edit.from)
    if (hits === 1) {
      next = next.replace(edit.from, () => edit.to)
      changed = true
      continue
    }
    if (hits === 0 && count(next, edit.to) >= 1) continue
    return {
      status: 'conflict',
      next: live,
      error: hits > 1 ? `found ${hits}× ${JSON.stringify(edit.from.slice(0, 60))}` : `not found ${JSON.stringify(edit.from.slice(0, 60))}`,
    }
  }
  return changed ? { status: 'change', next } : { status: 'same', next }
}
