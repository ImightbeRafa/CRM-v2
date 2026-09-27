/**
 * Display layer for WhatsApp / Instagram messages whose stored `content` is a
 * `[type]` placeholder (see `getWhatsAppContent` / `getInstagramContent` in
 * `meta-chat.ts`). Pure and client-safe: reads `content`, `messageType` and
 * `metadata.rawMessage` only, so it also fixes rows stored before this existed.
 *
 * Meta's `unsupported` type carries no content (error 131051) — we say so plainly
 * instead of pretending to know what it was.
 */

export type ChatMessageNotice = {
  /** Short label shown in the bubble, e.g. "Reacción 👍". */
  title: string
  /** Optional second line (what happened / what to do). */
  detail?: string
  /** https link to the shared item, when Meta provided one. */
  href?: string
  hrefLabel?: string
  /** `muted` = content WhatsApp/IG did not share with us. */
  tone: 'info' | 'muted'
}

type DisplayInput = {
  /** Message id: IG notices link to `/api/chat/media/[id]` (never to a CDN URL). */
  id?: string | null
  content?: string | null
  messageType?: string | null
  metadata?: unknown
}

const PLACEHOLDER = /^\[([a-z_]+)\]$/

/** Media placeholders are rendered by the media component, not here. */
const MEDIA_TYPES = new Set(['image', 'audio', 'voice', 'document', 'video', 'sticker'])

/** Known values Meta may put in `unsupported.type` (newer Graph versions). */
const UNSUPPORTED_KIND_LABEL: Record<string, string> = {
  edit: 'un mensaje editado',
  edited: 'un mensaje editado',
  poll: 'una encuesta',
  poll_creation: 'una encuesta',
  poll_update: 'un voto en una encuesta',
  view_once: 'una foto o video de "ver una vez"',
  event: 'un evento',
  event_creation: 'un evento',
  album: 'un álbum de fotos',
  keep_in_chat: 'un mensaje guardado en el chat',
  pin: 'un mensaje fijado',
  video_note: 'una nota de video',
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** Every `[type]` token `meta-chat.ts` can store (a customer typing "[ok]" is not one). */
const KNOWN_TOKENS = new Set([
  ...MEDIA_TYPES,
  'unsupported', 'unknown', 'reaction', 'contact', 'contacts', 'location', 'order', 'system',
  'request_welcome', 'ephemeral', 'interactive', 'story_mention', 'share', 'reel', 'ig_reel',
  'template', 'fallback', 'unsupported_type', 'attachment',
])

/** Types Meta delivers with no text, so `getWhatsAppContent` stores ''. */
const EMPTY_BODY_TYPES = new Set(['reaction', 'interactive', 'unsupported', 'unknown'])

function placeholderType(input: DisplayInput): string | null {
  const content = (input.content || '').trim()
  const type = (input.messageType || '').toLowerCase()
  const match = PLACEHOLDER.exec(content)
  if (match) return match[1] === type || KNOWN_TOKENS.has(match[1]) ? match[1] : null
  if (!content && EMPTY_BODY_TYPES.has(type)) return type
  return null
}

function unsupportedNotice(raw: Record<string, any> | null): ChatMessageNotice {
  const kind = typeof raw?.unsupported?.type === 'string' ? raw.unsupported.type.toLowerCase() : ''
  const what = UNSUPPORTED_KIND_LABEL[kind]
  return {
    title: 'Mensaje no compatible',
    detail: what
      ? `El cliente envió ${what}. WhatsApp no comparte ese tipo de mensaje con Betsy — revisalo en el teléfono.`
      : 'WhatsApp no comparte este tipo de mensaje con Betsy (por ejemplo encuestas, "ver una vez", eventos o mensajes editados). Revisalo en el teléfono.',
    tone: 'muted',
  }
}

function whatsappNotice(type: string, raw: Record<string, any> | null): ChatMessageNotice | null {
  switch (type) {
    case 'unsupported':
    case 'unknown':
      return unsupportedNotice(raw)
    case 'reaction': {
      const emoji = typeof raw?.reaction?.emoji === 'string' ? raw.reaction.emoji : ''
      return emoji
        ? { title: `Reaccionó ${emoji}`, detail: 'a un mensaje del chat', tone: 'info' }
        : { title: 'Quitó una reacción', tone: 'muted' }
    }
    case 'contact':
    case 'contacts': {
      const list: any[] = Array.isArray(raw?.contacts) ? raw.contacts : []
      const lines = list
        .map((c) => {
          const name = c?.name?.formatted_name || c?.name?.first_name || ''
          const phone = c?.phones?.[0]?.phone || c?.phones?.[0]?.wa_id || ''
          return [name, phone].filter(Boolean).join(' · ')
        })
        .filter(Boolean)
      return {
        title: list.length > 1 ? `Compartió ${list.length} contactos` : 'Compartió un contacto',
        detail: lines.join('\n') || undefined,
        tone: 'info',
      }
    }
    case 'location': {
      const lat = Number(raw?.location?.latitude)
      const lng = Number(raw?.location?.longitude)
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
      return {
        title: 'Compartió una ubicación',
        detail: [raw?.location?.name, raw?.location?.address].filter(Boolean).join(' · ') || undefined,
        href: hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : undefined,
        hrefLabel: hasCoords ? 'Ver en el mapa' : undefined,
        tone: 'info',
      }
    }
    case 'order': {
      const items: any[] = Array.isArray(raw?.order?.product_items) ? raw.order.product_items : []
      return {
        title: 'Envió un pedido del catálogo',
        detail: items.length ? `${items.length} producto${items.length === 1 ? '' : 's'}` : undefined,
        tone: 'info',
      }
    }
    case 'system':
      return {
        title: 'Aviso de WhatsApp',
        detail: typeof raw?.system?.body === 'string' ? raw.system.body : undefined,
        tone: 'muted',
      }
    case 'request_welcome':
      return { title: 'El cliente abrió el chat', tone: 'muted' }
    case 'ephemeral':
      return {
        title: 'Mensaje temporal',
        detail: 'El chat tiene mensajes temporales activados; WhatsApp no comparte el contenido.',
        tone: 'muted',
      }
    case 'interactive':
      return raw?.interactive?.type === 'nfm_reply'
        ? { title: 'Completó un formulario', tone: 'info' }
        : null
    default:
      return null
  }
}

function instagramNotice(
  type: string,
  raw: Record<string, any> | null,
  messageId?: string | null,
): ChatMessageNotice | null {
  const attachment = Array.isArray(raw?.attachments) ? raw.attachments[0] : null
  // Server raw payload (tests / legacy): https URL. Client DTO: `hasUrl` → our media route.
  const href =
    messageId && (attachment?.hasUrl === true || safeHttpsUrl(attachment?.payload?.url))
      ? `/api/chat/media/${encodeURIComponent(messageId)}`
      : undefined
  switch (type) {
    case 'story_mention':
      return { title: 'Te mencionó en su historia', href, hrefLabel: href ? 'Ver historia' : undefined, tone: 'info' }
    case 'share':
      return { title: 'Compartió una publicación', href, hrefLabel: href ? 'Ver publicación' : undefined, tone: 'info' }
    case 'reel':
    case 'ig_reel':
      return { title: 'Compartió un reel', href, hrefLabel: href ? 'Ver reel' : undefined, tone: 'info' }
    case 'template':
    case 'fallback':
      return {
        title: 'Compartió un enlace',
        detail: typeof attachment?.payload?.title === 'string' ? attachment.payload.title : undefined,
        href,
        hrefLabel: href ? 'Abrir' : undefined,
        tone: 'info',
      }
    case 'unsupported_type':
    case 'unsupported':
      return {
        title: 'Mensaje no compatible',
        detail: 'Instagram no comparte este tipo de mensaje con Betsy. Revisalo en la app de Instagram.',
        tone: 'muted',
      }
    case 'attachment':
      return { title: 'Envió un adjunto', href, hrefLabel: href ? 'Abrir' : undefined, tone: 'info' }
    default:
      return null
  }
}

/**
 * Returns a notice for placeholder messages, or `null` when the stored content
 * should be shown as-is (normal text, captions, media handled elsewhere).
 */
export function describeChatMessage(input: DisplayInput): ChatMessageNotice | null {
  const type = placeholderType(input)
  if (!type || MEDIA_TYPES.has(type)) return null
  const meta = asRecord(input.metadata)
  const raw = asRecord(meta?.rawMessage)
  const platform = typeof meta?.platform === 'string' ? meta.platform : ''
  const isInstagram = platform === 'instagram' || Array.isArray(raw?.attachments)
  const notice = isInstagram ? instagramNotice(type, raw, input.id) : whatsappNotice(type, raw)
  if (notice) return notice
  if (raw?.is_unsupported === true) return instagramNotice('unsupported', raw, input.id)
  // Any other `[type]` token: never show raw brackets.
  return { title: 'Mensaje de un tipo no soportado', detail: `Tipo: ${type}`, tone: 'muted' }
}

const PREVIEW_LABEL: Record<string, string> = {
  unsupported: 'Mensaje no compatible',
  unknown: 'Mensaje no compatible',
  unsupported_type: 'Mensaje no compatible',
  reaction: 'Reacción',
  contact: 'Contacto',
  contacts: 'Contacto',
  location: 'Ubicación',
  order: 'Pedido del catálogo',
  system: 'Aviso de WhatsApp',
  request_welcome: 'Abrió el chat',
  ephemeral: 'Mensaje temporal',
  story_mention: 'Te mencionó en su historia',
  share: 'Publicación compartida',
  reel: 'Reel compartido',
  ig_reel: 'Reel compartido',
  template: 'Enlace',
  fallback: 'Enlace',
  attachment: 'Adjunto',
  image: 'Foto',
  video: 'Video',
  audio: 'Audio',
  voice: 'Nota de voz',
  document: 'Documento',
  sticker: 'Sticker',
}

/** Conversation-list preview: turns a bare `[type]` last message into Spanish. */
export function chatPreviewText(lastMessage: string | null | undefined): string {
  const text = (lastMessage || '').trim()
  const match = PLACEHOLDER.exec(text)
  if (!match || !KNOWN_TOKENS.has(match[1])) return text
  return PREVIEW_LABEL[match[1]] ?? 'Mensaje'
}

/**
 * Client-safe projection of `metadata.rawMessage` for the message DTO. Keeps only what
 * `describeChatMessage` reads and drops every URL, so Meta CDN links never reach the
 * browser (media is served by `/api/chat/media/[id]`).
 */
export function projectRawMessageForClient(raw: unknown): Record<string, unknown> | undefined {
  const r = asRecord(raw)
  if (!r) return undefined
  const out: Record<string, unknown> = {}
  if (typeof r.type === 'string') out.type = r.type
  if (asRecord(r.unsupported) && typeof r.unsupported.type === 'string') out.unsupported = { type: r.unsupported.type }
  if (asRecord(r.reaction)) out.reaction = { emoji: typeof r.reaction.emoji === 'string' ? r.reaction.emoji : '' }
  if (Array.isArray(r.contacts)) {
    out.contacts = r.contacts.slice(0, 10).map((c: any) => ({
      name: { formatted_name: c?.name?.formatted_name, first_name: c?.name?.first_name },
      phones: Array.isArray(c?.phones) ? c.phones.slice(0, 1).map((ph: any) => ({ phone: ph?.phone, wa_id: ph?.wa_id })) : [],
    }))
  }
  if (asRecord(r.location)) {
    const { latitude, longitude, name, address } = r.location
    out.location = { latitude, longitude, name, address }
  }
  if (asRecord(r.order)) {
    out.order = { product_items: Array.isArray(r.order.product_items) ? r.order.product_items.map(() => ({})) : [] }
  }
  if (asRecord(r.system) && typeof r.system.body === 'string') out.system = { body: r.system.body }
  if (asRecord(r.interactive) && typeof r.interactive.type === 'string') out.interactive = { type: r.interactive.type }
  if (Array.isArray(r.attachments)) {
    out.attachments = r.attachments.slice(0, 5).map((a: any) => ({
      type: a?.type,
      // Title is text, not a link. `hasUrl` lets the UI offer our own media route.
      payload: { title: typeof a?.payload?.title === 'string' ? a.payload.title : undefined },
      hasUrl: typeof a?.payload?.url === 'string',
    }))
  }
  if (r.is_unsupported === true) out.is_unsupported = true
  return out
}
