/**
 * Images that ride with an agent reply (B4). The model marks the saved reply it used with [[ATAJO:clave]]
 * (stripped by code, like [[DATOS_PAGO]]); the keyword fast path already knows its key. Code — never the
 * model — picks the images: only an active, owner-made reply of this agent, ≤3, and never an image this
 * chat already got.
 */

// Type-only: this module stays pure (no sharp / DB) so the output validator can use it.
import type { AgentAsset } from '@/lib/soft-ai/agent-assets'
import { isReservedShortcutKey, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'

const MAX_IMAGES_PER_REPLY = 3

export type ReplyImage = {
  assetId: string
  url: string
  mimeType: AgentAsset['mimeType']
  name: string
  width: number | null
  height: number | null
}

// Lenient on spacing / case / any bracket kind (or none) so a near-miss never leaks to the customer (INT-80).
// 1) Bracketed (any bracket kind): the whole bracket goes, whatever is inside. 2) Bare "ATAJO: clave".
const BRACKETED_TAG_RE = /[[【〔{(<]{1,2}\s*ATAJO(?![\p{L}])([^\n\]】〕})>]{0,60})[\]】〕})>]{0,2}/giu
const BARE_TAG_RE = /(?<![\p{L}])ATAJO\s*[:=]\s*([a-z0-9_-]{2,40})/giu
const TAG_KEY_RE = /^\s*[:=]\s*([a-z0-9_]{2,40})\s*$/i

/** Removes every [[ATAJO:…]] tag; returns the first key named. */
export function extractShortcutTag(text: string): { text: string; key: string | null } {
  let key: string | null = null
  const take = (k: string | undefined) => {
    if (!key && k && /^[a-z0-9_]{2,40}$/i.test(k)) key = k.toLowerCase()
  }
  const stripped = (text || '')
    .normalize('NFKC')
    .replace(BRACKETED_TAG_RE, (_m, inner: string) => {
      take(TAG_KEY_RE.exec(inner)?.[1])
      return ''
    })
    .replace(BARE_TAG_RE, (_m, k: string) => {
      take(k)
      return ''
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { text: stripped, key }
}

/** The owner-made replies the model may name (switched on; never the fixed sys_* system replies). */
export function isImageEligibleShortcut(row: RuntimeShortcut): boolean {
  return Boolean(row.id) && row.isActive && row.kind === 'playbook' && !isReservedShortcutKey(row.key)
}

export function selectReplyImages(input: {
  shortcutKey: string | null | undefined
  shortcuts: RuntimeShortcut[]
  assetsByShortcut: Map<string, AgentAsset[]>
  /** Asset ids or sha256 already sent in this chat. */
  alreadySent?: Iterable<string>
}): { key: string | null; images: ReplyImage[] } {
  if (!input.shortcutKey) return { key: null, images: [] }
  const row = input.shortcuts.find((s) => s.key === input.shortcutKey && isImageEligibleShortcut(s))
  if (!row?.id) return { key: null, images: [] }
  const sent = new Set(input.alreadySent ?? [])
  const images = (input.assetsByShortcut.get(row.id) ?? [])
    .filter((a) => !sent.has(a.id) && !sent.has(a.sha256))
    .slice(0, MAX_IMAGES_PER_REPLY)
    .map((a) => ({ assetId: a.id, url: a.url, mimeType: a.mimeType, name: a.name, width: a.width, height: a.height }))
  return { key: row.key, images }
}

/** Saved replies that would really send an image now (≥1 not yet sent in this chat). The catalog only marks these. */
export function sendableImageReplyIds(assetsByShortcut: Map<string, AgentAsset[]>, alreadySent: Iterable<string> = []): Set<string> {
  const sent = new Set(alreadySent)
  const out = new Set<string>()
  for (const [shortcutId, list] of assetsByShortcut) {
    if (list.some((a) => !sent.has(a.id) && !sent.has(a.sha256))) out.add(shortcutId)
  }
  return out
}
