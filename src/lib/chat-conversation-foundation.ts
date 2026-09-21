/**
 * Pure helpers for ChatConversation backfill / upsert planning (PR-1).
 * No Prisma / DB imports — safe for offline node:test.
 */

export const CHAT_INBOX_PREVIEW_MAX = 120
export const CHAT_INBOX_BACKFILL_DEFAULT_BATCH = 1000
export const CHAT_INBOX_BACKFILL_MAX_BATCH = 1000

export type ChatMessageDirection = 'inbound' | 'outbound' | string

export interface LegacyChatMetadata {
  from?: string
  to?: string
  waId?: string
  providerMessageId?: string
  name?: string
  username?: string
  platform?: string
  messageType?: string
  type?: string
  [key: string]: unknown
}

export interface ChatInboxBackfillMessage {
  id: string
  tenantId: string
  socialAccountId: string
  direction: ChatMessageDirection
  content: string
  sentAt: Date | string
  metadata?: unknown
  providerMessageId?: string | null
  peerId?: string | null
  conversationId?: string | null
  duplicateOfMessageId?: string | null
  messageType?: string | null
}

export type PeerDerivation =
  | { ok: true; peerId: string; peerName: string | null }
  | { ok: false; reason: 'missing_peer' | 'literal_unknown'; peerId: null }

export interface ConversationNaturalKey {
  tenantId: string
  socialAccountId: string
  peerId: string
}

export interface ConversationSeedInput extends ConversationNaturalKey {
  peerName: string | null
  lastMessageId: string
  lastMessageAt: Date
  lastMessagePreview: string
  lastMessageDirection: string
  lastInboundAt: Date | null
  lastOutboundAt: Date | null
  inboundCount: number
  messageCount: number
}

export interface ConversationAggregate {
  lastMessageId: string | null
  lastMessageAt: Date | null
  lastMessagePreview: string | null
  lastMessageDirection: string | null
  lastInboundAt: Date | null
  lastOutboundAt: Date | null
  inboundCount: number
  messageCount: number
}

export interface DuplicatePatch {
  id: string
  duplicateOfMessageId: string
  providerMessageId: null
  metadata: Record<string, unknown>
}

export interface ChatInboxBackfillOptions {
  apply: boolean
  dryRun: boolean
  batchSize: number
  tenantId: string | null
  confirmHost: string | null
  afterSentAt: string | null
  afterId: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseLegacyChatMetadata(metadata: unknown): LegacyChatMetadata {
  const raw = asRecord(metadata)
  return {
    ...raw,
    from: trimString(raw.from) || undefined,
    to: trimString(raw.to) || undefined,
    waId: trimString(raw.waId) || undefined,
    providerMessageId: trimString(raw.providerMessageId) || undefined,
    name: trimString(raw.name) || undefined,
    username: trimString(raw.username) || undefined,
    platform: trimString(raw.platform) || undefined,
    messageType: trimString(raw.messageType) || trimString(raw.type) || undefined,
  }
}

export function toMessageDate(value: Date | string): Date {
  if (value instanceof Date) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid message timestamp: ${String(value)}`)
  }
  return parsed
}

export function compareMessageOrder(
  a: { sentAt: Date | string; id: string },
  b: { sentAt: Date | string; id: string },
): number {
  const aTime = toMessageDate(a.sentAt).getTime()
  const bTime = toMessageDate(b.sentAt).getTime()
  if (aTime !== bTime) return aTime < bTime ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

export function truncatePreview(content: string, max = CHAT_INBOX_PREVIEW_MAX): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return normalized.slice(0, max)
}

export function deriveConversationPeer(message: {
  direction: string
  metadata?: unknown
  peerId?: string | null
}): PeerDerivation {
  const promoted = trimString(message.peerId)
  if (promoted) {
    if (promoted.toLowerCase() === 'unknown') {
      return { ok: false, reason: 'literal_unknown', peerId: null }
    }
    const meta = parseLegacyChatMetadata(message.metadata)
    return {
      ok: true,
      peerId: promoted,
      peerName: meta.name || meta.username || null,
    }
  }

  const meta = parseLegacyChatMetadata(message.metadata)
  let peerId = ''
  if (message.direction === 'inbound') {
    peerId = meta.from || meta.waId || ''
  } else if (message.direction === 'outbound') {
    // SMB / history echoes often carry the customer peer in `from`.
    peerId = meta.to || meta.from || ''
  } else {
    peerId = meta.from || meta.to || meta.waId || ''
  }

  if (!peerId) return { ok: false, reason: 'missing_peer', peerId: null }
  if (peerId.toLowerCase() === 'unknown') {
    return { ok: false, reason: 'literal_unknown', peerId: null }
  }

  return {
    ok: true,
    peerId,
    peerName: meta.name || meta.username || null,
  }
}

export function extractProviderMessageId(message: {
  providerMessageId?: string | null
  metadata?: unknown
}): string | null {
  const promoted = trimString(message.providerMessageId)
  if (promoted) return promoted
  const meta = parseLegacyChatMetadata(message.metadata)
  return meta.providerMessageId || null
}

export function extractMessageType(message: {
  messageType?: string | null
  metadata?: unknown
}): string | null {
  const promoted = trimString(message.messageType)
  if (promoted) return promoted
  const meta = parseLegacyChatMetadata(message.metadata)
  return meta.messageType || null
}

export function conversationNaturalKey(
  message: ChatInboxBackfillMessage,
  peerId: string,
): ConversationNaturalKey {
  return {
    tenantId: message.tenantId,
    socialAccountId: message.socialAccountId,
    peerId,
  }
}

export function buildConversationSeed(
  message: ChatInboxBackfillMessage,
  peer: Extract<PeerDerivation, { ok: true }>,
): ConversationSeedInput {
  const sentAt = toMessageDate(message.sentAt)
  const inbound = message.direction === 'inbound'
  return {
    ...conversationNaturalKey(message, peer.peerId),
    peerName: peer.peerName,
    lastMessageId: message.id,
    lastMessageAt: sentAt,
    lastMessagePreview: truncatePreview(message.content),
    lastMessageDirection: message.direction,
    lastInboundAt: inbound ? sentAt : null,
    lastOutboundAt: inbound ? null : sentAt,
    inboundCount: inbound ? 1 : 0,
    messageCount: 1,
  }
}

export function chooseCanonicalProviderMessage<T extends { sentAt: Date | string; id: string }>(
  rows: T[],
): T {
  if (rows.length === 0) throw new Error('chooseCanonicalProviderMessage requires at least one row')
  return [...rows].sort(compareMessageOrder)[0]
}

export function mergeBackfillAuditMetadata(
  metadata: unknown,
  details: Record<string, unknown>,
): Record<string, unknown> {
  const base = asRecord(metadata)
  const existingAudit = asRecord(base.audit)
  const existingBackfill = asRecord(existingAudit.chatInboxBackfill)
  return {
    ...base,
    audit: {
      ...existingAudit,
      chatInboxBackfill: {
        ...existingBackfill,
        ...details,
      },
    },
  }
}

export function planDuplicatePatches(
  rows: Array<ChatInboxBackfillMessage & { providerMessageId: string }>,
): DuplicatePatch[] {
  if (rows.length < 2) return []
  const canonical = chooseCanonicalProviderMessage(rows)
  const patches: DuplicatePatch[] = []
  for (const row of rows) {
    if (row.id === canonical.id) continue
    patches.push({
      id: row.id,
      duplicateOfMessageId: canonical.id,
      providerMessageId: null,
      metadata: mergeBackfillAuditMetadata(row.metadata, {
        originalProviderMessageId: row.providerMessageId,
        duplicateOfMessageId: canonical.id,
        markedAt: new Date().toISOString(),
      }),
    })
  }
  return patches
}

export function buildMessageBackfillPatch(
  message: ChatInboxBackfillMessage,
  peer: Extract<PeerDerivation, { ok: true }>,
  conversationId: string,
): {
  conversationId: string
  peerId: string
  providerMessageId: string | null
  messageType: string | null
} {
  return {
    conversationId,
    peerId: peer.peerId,
    providerMessageId: extractProviderMessageId(message),
    messageType: extractMessageType(message),
  }
}

export function computeConversationAggregate(
  messages: ChatInboxBackfillMessage[],
): ConversationAggregate {
  const active = messages.filter((row) => !row.duplicateOfMessageId)
  if (active.length === 0) {
    return {
      lastMessageId: null,
      lastMessageAt: null,
      lastMessagePreview: null,
      lastMessageDirection: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      inboundCount: 0,
      messageCount: 0,
    }
  }

  const sorted = [...active].sort(compareMessageOrder)
  const latest = sorted[sorted.length - 1]
  let lastInboundAt: Date | null = null
  let lastOutboundAt: Date | null = null
  let inboundCount = 0

  for (const row of sorted) {
    const sentAt = toMessageDate(row.sentAt)
    if (row.direction === 'inbound') {
      inboundCount += 1
      lastInboundAt = sentAt
    } else if (row.direction === 'outbound') {
      lastOutboundAt = sentAt
    }
  }

  return {
    lastMessageId: latest.id,
    lastMessageAt: toMessageDate(latest.sentAt),
    lastMessagePreview: truncatePreview(latest.content),
    lastMessageDirection: latest.direction,
    lastInboundAt,
    lastOutboundAt,
    inboundCount,
    messageCount: active.length,
  }
}

export function compareConversationAggregate(
  actual: ConversationAggregate,
  expected: ConversationAggregate,
): string[] {
  const errors: string[] = []
  const fields: Array<keyof ConversationAggregate> = [
    'lastMessageId',
    'lastMessagePreview',
    'lastMessageDirection',
    'inboundCount',
    'messageCount',
  ]
  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      errors.push(`${field}: actual=${String(actual[field])} expected=${String(expected[field])}`)
    }
  }
  const timeFields: Array<'lastMessageAt' | 'lastInboundAt' | 'lastOutboundAt'> = [
    'lastMessageAt',
    'lastInboundAt',
    'lastOutboundAt',
  ]
  for (const field of timeFields) {
    const a = actual[field] ? toMessageDate(actual[field]!).getTime() : null
    const e = expected[field] ? toMessageDate(expected[field]!).getTime() : null
    if (a !== e) {
      errors.push(`${field}: actual=${String(actual[field])} expected=${String(expected[field])}`)
    }
  }
  return errors
}

export function parseChatBackfillOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ChatInboxBackfillOptions {
  const apply = argv.includes('--apply')
  const tenantArg = argv.find((arg) => arg.startsWith('--tenant='))
  const batchArg = argv.find((arg) => arg.startsWith('--batch-size='))
  const afterSentAtArg = argv.find((arg) => arg.startsWith('--after-sent-at='))
  const afterIdArg = argv.find((arg) => arg.startsWith('--after-id='))

  let batchSize = CHAT_INBOX_BACKFILL_DEFAULT_BATCH
  if (batchArg) {
    const parsed = Number.parseInt(batchArg.slice('--batch-size='.length), 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error('--batch-size must be a positive integer')
    }
    batchSize = Math.min(parsed, CHAT_INBOX_BACKFILL_MAX_BATCH)
  }

  return {
    apply,
    dryRun: !apply,
    batchSize,
    tenantId: tenantArg ? tenantArg.slice('--tenant='.length).trim() || null : null,
    confirmHost: env.CHAT_INBOX_BACKFILL_CONFIRM_HOST?.trim() || null,
    afterSentAt: afterSentAtArg ? afterSentAtArg.slice('--after-sent-at='.length) : null,
    afterId: afterIdArg ? afterIdArg.slice('--after-id='.length) : null,
  }
}

export function naturalKeyString(key: ConversationNaturalKey): string {
  return `${key.tenantId}\0${key.socialAccountId}\0${key.peerId}`
}

/**
 * In-memory / offline backfill planner for one batch of messages.
 * Advances the keyset cursor even for quarantined rows (resumable, no loops).
 */
export function planBackfillBatch(
  messages: ChatInboxBackfillMessage[],
  conversationIdsByKey: Map<string, string>,
  allocateConversationId: (key: ConversationNaturalKey) => string,
): {
  linked: Array<{
    messageId: string
    conversationId: string
    peerId: string
    providerMessageId: string | null
    messageType: string | null
    seed: ConversationSeedInput
    createdConversation: boolean
  }>
  quarantined: Array<{ messageId: string; reason: string }>
  touchedConversationIds: Set<string>
  nextCursor: { sentAt: string; id: string } | null
} {
  const linked: Array<{
    messageId: string
    conversationId: string
    peerId: string
    providerMessageId: string | null
    messageType: string | null
    seed: ConversationSeedInput
    createdConversation: boolean
  }> = []
  const quarantined: Array<{ messageId: string; reason: string }> = []
  const touchedConversationIds = new Set<string>()

  const ordered = [...messages].sort(compareMessageOrder)
  for (const message of ordered) {
    if (message.conversationId) continue
    const peer = deriveConversationPeer(message)
    if (!peer.ok) {
      quarantined.push({ messageId: message.id, reason: peer.reason })
      continue
    }
    const key = conversationNaturalKey(message, peer.peerId)
    const keyStr = naturalKeyString(key)
    let conversationId = conversationIdsByKey.get(keyStr)
    let createdConversation = false
    if (!conversationId) {
      conversationId = allocateConversationId(key)
      conversationIdsByKey.set(keyStr, conversationId)
      createdConversation = true
    }
    const seed = buildConversationSeed(message, peer)
    linked.push({
      messageId: message.id,
      conversationId,
      peerId: peer.peerId,
      providerMessageId: extractProviderMessageId(message),
      messageType: extractMessageType(message),
      seed,
      createdConversation,
    })
    touchedConversationIds.add(conversationId)
  }

  const last = ordered[ordered.length - 1]
  const nextCursor = last
    ? { sentAt: toMessageDate(last.sentAt).toISOString(), id: last.id }
    : null

  return { linked, quarantined, touchedConversationIds, nextCursor }
}
