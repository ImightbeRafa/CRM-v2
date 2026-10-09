/**
 * The agent's own reply library (B2): add the ready-made sales replies, or copy the team's quick replies
 * (text + photos) into this agent. Everything lands switched off so nothing reaches customers until the
 * owner turns it on. Tenant + agent scoped; photos are re-encoded through agent-assets.
 */

import { prisma } from '@/lib/db'
import { readChatMediaFromBlob } from '@/lib/chat-media'
import { isQuickReplyMediaPath, quickRepliesFromSettings } from '@/lib/chat-quick-replies'
import { AgentAssetError, MAX_IMAGES_PER_REPLY, setReplyAssets, storeAgentAsset } from '@/lib/soft-ai/agent-assets'
import { createShortcut } from '@/lib/soft-ai/shortcut-admin'
import { SALES_REPLY_TEMPLATES, validateShortcutForSave, type ShortcutDraft } from '@/lib/soft-ai/shortcuts'

type Actor = { tenantId: string; agentId: string; actorUserId: string; actorName: string; actorRole: string }

async function existingKeys(tenantId: string, agentId: string): Promise<Set<string>> {
  const rows = await prisma.chatAgentShortcut.findMany({ where: { tenantId, agentId }, select: { key: true } })
  return new Set(rows.map((r) => r.key))
}

/** Adds the missing ready-made sales replies (off). Returns how many were added. */
export async function seedSalesReplies(actor: Actor): Promise<number> {
  const have = await existingKeys(actor.tenantId, actor.agentId)
  let added = 0
  for (const [index, template] of SALES_REPLY_TEMPLATES.entries()) {
    if (have.has(template.key)) continue
    await createShortcut({ ...actor, draft: { ...template, isActive: false, sortOrder: 50 + index } })
    added += 1
  }
  return added
}

/** Team quick-reply shortcut → agent key: `eq_` + [a-z0-9_], ≤40 chars. */
export function importedReplyKey(shortcut: string): string {
  const slug = shortcut.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 37)
  return slug ? `eq_${slug}` : ''
}

/** Draft for one team quick reply, or null when it cannot become an agent reply (empty, confirmation wording…). */
export function importedReplyDraft(item: { shortcut: string; text: string; hasImages: boolean }, sortOrder: number): ShortcutDraft | null {
  const key = importedReplyKey(item.shortcut)
  if (!key) return null
  const body = (item.text.trim() || (item.hasImages ? 'Te paso la info 👇' : '')).replace(/\{nombre\}/gi, '{{client.firstName}}').slice(0, 1500)
  const draft: ShortcutDraft = {
    key,
    title: `/${item.shortcut}`.slice(0, 60),
    kind: 'playbook',
    intents: [],
    keywords: [],
    // Team wording can carry prices or deals: the agent adapts it and every rule still checks the result.
    deliveryMode: 'guide',
    body,
    isActive: false,
    sortOrder,
  }
  return validateShortcutForSave(draft).ok ? draft : null
}

export type ImportResult = { added: number; skipped: number; images: number }

/** Copies the team quick replies (≤60) into this agent, with their photos (jpeg/png only, ≤3 each). */
export async function importTeamQuickReplies(actor: Actor): Promise<ImportResult> {
  const tenant = await prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { settings: true } })
  const items = quickRepliesFromSettings(tenant?.settings).slice(0, 60)
  const have = await existingKeys(actor.tenantId, actor.agentId)
  const result: ImportResult = { added: 0, skipped: 0, images: 0 }
  for (const [index, item] of items.entries()) {
    const photos = (item.media ?? [])
      .filter((m) => /^image\/(jpeg|png)$/.test(m.mime) && isQuickReplyMediaPath(m.path, actor.tenantId))
      .slice(0, MAX_IMAGES_PER_REPLY)
    const draft = importedReplyDraft({ shortcut: item.shortcut, text: item.text, hasImages: photos.length > 0 }, 200 + index)
    if (!draft || have.has(draft.key)) {
      result.skipped += 1
      continue
    }
    const row = await createShortcut({ ...actor, draft })
    have.add(draft.key)
    result.added += 1
    const assetIds: string[] = []
    for (const photo of photos) {
      try {
        const stored = await readChatMediaFromBlob({ pathname: photo.path })
        const asset = await storeAgentAsset({
          tenantId: actor.tenantId,
          agentId: actor.agentId,
          bytes: stored.bytes,
          name: photo.filename,
          userId: actor.actorUserId,
        })
        assetIds.push(asset.id)
      } catch (error) {
        // A missing / odd photo never blocks the text; a full quota stops copying photos.
        if (error instanceof AgentAssetError && (error.code === 'quota' || error.code === 'not_ready')) break
      }
    }
    if (assetIds.length) result.images += (await setReplyAssets({ tenantId: actor.tenantId, agentId: actor.agentId, shortcutId: row.id, assetIds })).length
  }
  return result
}
