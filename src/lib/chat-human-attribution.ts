/**
 * Human outbound attribution for /chats (Respond.io-style).
 * Snapshot name+image into message metadata at send time so later
 * profile edits do not rewrite history (same pattern as Soft AI agentName).
 */

export type HumanSenderSnapshot = {
  senderUserId: string
  senderName: string
  senderImage: string | null
}

export function buildHumanSenderSnapshot(input: {
  userId: string
  name?: string | null
  username?: string | null
  email?: string | null
  image?: string | null
}): HumanSenderSnapshot {
  const senderName =
    (input.name && input.name.trim()) ||
    (input.username && input.username.trim()) ||
    (input.email && input.email.trim()) ||
    'Agente'
  return {
    senderUserId: input.userId,
    senderName,
    senderImage: input.image?.trim() || null,
  }
}

export function mergeHumanSenderMetadata(
  metadata: Record<string, unknown> | null | undefined,
  snapshot: HumanSenderSnapshot,
): Record<string, unknown> {
  return {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    senderUserId: snapshot.senderUserId,
    senderName: snapshot.senderName,
    senderImage: snapshot.senderImage,
  }
}

function asMeta(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return metadata as Record<string, unknown>
}

export function humanOutboundSender(metadata: unknown): {
  name: string | null
  image: string | null
  userId: string | null
} {
  const meta = asMeta(metadata)
  if (!meta) return { name: null, image: null, userId: null }
  const userId = typeof meta.senderUserId === 'string' ? meta.senderUserId : null
  const name = typeof meta.senderName === 'string' && meta.senderName.trim()
    ? meta.senderName.trim()
    : null
  const image = typeof meta.senderImage === 'string' && meta.senderImage.trim()
    ? meta.senderImage.trim()
    : null
  return { name, image, userId }
}

/** Footer label under a human outbound bubble. */
export function humanOutboundLabel(metadata: unknown): string | null {
  const { name } = humanOutboundSender(metadata)
  return name ? `${name} envió` : null
}
