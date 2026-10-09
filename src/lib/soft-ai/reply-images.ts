/**
 * Images that ride with an agent reply (B4). The model marks the saved reply it used with [[ATAJO:clave]]
 * (stripped by code, like [[DATOS_PAGO]]); the keyword fast path already knows its key. Code — never the
 * model — picks the images: only an active, owner-made reply of this agent, ≤3, and never an image this
 * chat already got.
 */

import type { AgentAsset } from '@/lib/soft-ai/agent-assets'
import { MAX_IMAGES_PER_REPLY } from '@/lib/soft-ai/agent-assets'
import { isReservedShortcutKey, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'

export type ReplyImage = {
  assetId: string
  url: string
  mimeType: AgentAsset['mimeType']
  sha256: string
  name: string
  width: number | null
  height: number | null
}

// Lenient on spacing / brackets / case so a near-miss never leaks to the customer.
const TAG_RE = /\[{1,2}\s*ATAJO\s*[:=]\s*([a-z0-9_]{2,40})\s*\]{1,2}/giu
const TAG_LEFTOVER_RE = /\[{1,2}\s*ATAJO[^\]\n]{0,60}\]{0,2}/giu

/** Removes every [[ATAJO:…]] tag; returns the first key named. */
export function extractShortcutTag(text: string): { text: string; key: string | null } {
  let key: string | null = null
  const stripped = (text || '')
    .replace(TAG_RE, (_m, k: string) => {
      if (!key) key = k.toLowerCase()
      return ''
    })
    .replace(TAG_LEFTOVER_RE, '')
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
    .map((a) => ({ assetId: a.id, url: a.url, mimeType: a.mimeType, sha256: a.sha256, name: a.name, width: a.width, height: a.height }))
  return { key: row.key, images }
}
