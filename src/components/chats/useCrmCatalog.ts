'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_CHAT_STAGES,
  DEFAULT_CHAT_TAGS,
  DEFAULT_CLIENT_STAGES,
  stageLabelOf,
  type StageDef,
  type StagePipeline,
  type TagDef,
} from '@/lib/crm-stages'

/**
 * The business's chat stages, client stages and tags (Config › Chats). One request per list per
 * page load (shared by every component), defaults until it arrives or when it fails.
 */
type Catalog = { chatStages: StageDef[]; clientStages: StageDef[]; tags: TagDef[] }

const DEFAULTS: Catalog = { chatStages: DEFAULT_CHAT_STAGES, clientStages: DEFAULT_CLIENT_STAGES, tags: DEFAULT_CHAT_TAGS }
let cached: Catalog | null = null
let inflight: Promise<Catalog> | null = null
const listeners = new Set<(c: Catalog) => void>()

async function fetchStages(pipeline: StagePipeline): Promise<StageDef[] | null> {
  try {
    const res = await fetch(`/api/config/crm-stages?pipeline=${pipeline}`, { credentials: 'same-origin', cache: 'no-store' })
    const json = (await res.json().catch(() => null)) as { success?: boolean; stages?: StageDef[] } | null
    return res.ok && json?.success && Array.isArray(json.stages) ? json.stages : null
  } catch {
    return null
  }
}

async function fetchTags(): Promise<TagDef[] | null> {
  try {
    const res = await fetch('/api/config/chat-tags', { credentials: 'same-origin', cache: 'no-store' })
    const json = (await res.json().catch(() => null)) as { success?: boolean; tags?: TagDef[] } | null
    return res.ok && json?.success && Array.isArray(json.tags) ? json.tags : null
  } catch {
    return null
  }
}

function load(): Promise<Catalog> {
  if (!inflight) {
    inflight = Promise.all([fetchStages('chat'), fetchStages('client'), fetchTags()]).then(([chatStages, clientStages, tags]) => {
      cached = {
        chatStages: chatStages ?? DEFAULTS.chatStages,
        clientStages: clientStages ?? DEFAULTS.clientStages,
        tags: tags ?? DEFAULTS.tags,
      }
      listeners.forEach((l) => l(cached!))
      return cached
    })
  }
  return inflight
}

/** After saving in Config › Chats: every mounted component picks up the new lists. */
export function refreshCrmCatalog(): Promise<Catalog> {
  inflight = null
  return load()
}

export function useCrmCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(cached ?? DEFAULTS)
  useEffect(() => {
    listeners.add(setCatalog)
    void load().then(setCatalog)
    return () => {
      listeners.delete(setCatalog)
    }
  }, [])
  return {
    ...catalog,
    /** Stages a chat can be moved to (archived ones are kept only for display). */
    activeChatStages: catalog.chatStages.filter((s) => !s.archived),
    activeClientStages: catalog.clientStages.filter((s) => !s.archived),
    activeTags: catalog.tags.filter((t) => !t.archived),
    chatStageLabel: (key: string | null | undefined) => stageLabelOf(catalog.chatStages, key),
    tagLabel: (key: string) => catalog.tags.find((t) => t.key === key)?.label ?? key,
  }
}

/** Stage colour tokens → chip classes (dark mode handled by the palette mapping). */
export function stageChipClass(color: string | null | undefined, active = true): string {
  if (!active) return 'bg-slate-100 text-slate-500 hover:bg-slate-200'
  switch (color) {
    case 'sky':
      return 'bg-sky-100 text-sky-800'
    case 'violet':
      return 'bg-violet-100 text-violet-800'
    case 'amber':
      return 'bg-amber-100 text-amber-900'
    case 'emerald':
      return 'bg-emerald-100 text-emerald-800'
    case 'rose':
      return 'bg-rose-100 text-rose-800'
    case 'orange':
      return 'bg-orange-100 text-orange-800'
    case 'teal':
      return 'bg-teal-100 text-teal-800'
    default:
      return 'bg-slate-200 text-slate-700'
  }
}
