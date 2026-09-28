'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react'
import Link from 'next/link'
import { Check, CheckCheck, ChevronLeft, Hand, Info, PanelRight, Paperclip, Pause, Play, Send, ShoppingBag, Smile, Sparkles, User, X, Zap } from 'lucide-react'
import {
  initialsFromName,
  isWhatsAppWindowOpen,
  type ConversationStatus,
  type SoftConversation,
  type SoftTag,
} from '@/lib/chat-soft-copilot'
import {
  agentModeLabel,
  isSoftHumanComposerEnabled,
} from '@/lib/soft-ai/agent-state'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import {
  isSoftAiOutboundMetadata,
  softAiOutboundLabel,
} from '@/lib/soft-ai/agent-inbox-projection'
import {
  humanOutboundLabel,
  humanOutboundSender,
} from '@/lib/chat-human-attribution'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import { describeChatMessage, isPlaceholderToken, type ChatMessageNotice } from '@/lib/chat-message-display'
import { ChatAssigneePicker, type ChatAssignee } from '@/components/chats/ChatAssigneePicker'
import { ChatMediaBubble } from '@/components/chats/ChatMediaBubble'
import {
  EmojiPickerPopover,
  QuickRepliesManager,
  QuickReplyMediaThumb,
  QuickReplySuggestions,
  RecentMediaPopover,
  useAutoGrowTextarea,
  type RecentMediaItem,
} from '@/components/chats/composer/ComposerExtras'
import { acceptsAttachment, fileFromClipboard, hasDraggedFiles } from '@/lib/chat-attachment-drop'
import {
  applyQuickReply,
  filterQuickReplies,
  slashQueryAt,
  type ChatQuickReply,
  type QuickReplyMedia,
} from '@/lib/chat-quick-replies'
import {
  AuroraEmptyState,
  AuroraErrorState,
  AuroraThreadSkeleton,
  ChannelDownBanner,
} from '@/components/aurora/states'
import { formatThreadChannelMeta, platformFullName } from '@/lib/social-account-identity'
import {
  CHAT_INBOX_V2_THREAD_RENDER_WINDOW,
  selectThreadRenderWindow,
} from '@/lib/chat-inbox-v2-client'
import {
  chatSendErrorNeedsReconnect,
  outboundDeliveryLabel,
  type ChatInboxMessage,
} from '@/lib/chat-inbox'

export type SoftWaTemplateOption = {
  name: string
  language: string
  category?: string
}

interface SoftThreadPaneProps {
  conversation: SoftConversation | null
  messageInput: string
  onMessageInput: (value: string) => void
  onSend: (e: FormEvent) => void
  sending: boolean
  sendError: string | null
  onClearError: () => void
  onRetry?: () => void
  onRetryMessage?: (messageId: string) => void
  failedOutboundId?: string | null
  composerRef?: Ref<HTMLTextAreaElement>
  onClose: () => void
  onBack?: () => void
  messagesEndRef: Ref<HTMLDivElement>
  messagesContainerRef: Ref<HTMLDivElement>
  onMessagesScroll: () => void
  showTemplateCta: boolean
  compact?: boolean
  hasMoreMessages?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void
  templates?: SoftWaTemplateOption[]
  templatesLoading?: boolean
  templatesError?: string | null
  showTemplatePicker?: boolean
  onOpenTemplatePicker?: () => void
  onCloseTemplatePicker?: () => void
  onSendTemplate?: (template: SoftWaTemplateOption) => void
  agentMode?: SoftAiAgentMode
  onTakeOver?: () => void
  onPauseAi?: () => void
  onResumeAi?: () => void
  aiBusy?: boolean
  /** Messages for the selected chat are still loading (STATE-01 skeleton). */
  threadLoading?: boolean
  /** Loading this chat's messages failed (shown instead of "Sin mensajes"). */
  threadError?: boolean
  onRetryThread?: () => void
  /** Selected line is down / needs repair (STATE-01 canal caído). */
  channelDownMessage?: string | null
  /** Mobile (compact): open the details / status sheet (CHAT-M02 person button). */
  onOpenDetails?: () => void
  /** Mobile (compact): agent tool actions logged today, shown in the agent banner. */
  agentActionsToday?: number
  /** Opens "Crear pedido" for this chat (the inbox links the order to the thread afterwards). */
  onCreateOrder?: () => void
  /** An unfinished order is saved for this chat: the button reads "Continuar pedido". */
  orderDraftPending?: boolean
  /** Desktop: show / hide the details panel (Detalle · Cliente · Agente). Shortcut: ]. */
  detailsPanel?: { open: boolean; onToggle: () => void }
  /** Attach + send a file (WhatsApp, flag-gated). Hidden when absent. */
  attachments?: {
    accept: string
    onSendFile: (file: File, caption: string) => Promise<boolean>
    /** Re-send a photo already sent from any chat ("Recientes"). */
    onSendRecent?: (sourceMessageId: string, caption: string) => Promise<boolean>
    /** Files of a quick reply, sent before the text (text = caption of the first when it fits). */
    onSendQuickReplyMedia?: (media: QuickReplyMedia[], text: string) => Promise<boolean>
  }
  /** Team quick replies: `/atajo` in the composer. Hidden when absent. */
  quickReplies?: {
    items: ChatQuickReply[]
    onSave: (items: ChatQuickReply[]) => Promise<string | null>
    /** Owners / admins edit the list; everyone uses it. */
    canManage?: boolean
  }
  /** Chat owner picker (Asignarme / teammates / Sin asignar). Hidden when absent. */
  assignment?: {
    assignees: ChatAssignee[]
    viewerUserId: string | null
    onAssign: (userId: string | null) => void
    busy?: boolean
  }
}

function formatMessageTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function DeliveryTicks({ status }: { status?: string | null }) {
  if (status === 'failed' || status === 'pending' || !status) return null
  const Icon = status === 'sent' ? Check : CheckCheck
  return (
    <Icon
      aria-label={status === 'read' ? 'Leído' : status === 'delivered' ? 'Entregado' : 'Enviado'}
      className={`h-3 w-3 ${status === 'read' ? 'text-au-ink-5b3fe0' : 'text-slate-400'}`}
    />
  )
}

function statusLabel(status: ConversationStatus) {
  if (status === 'nuevo') return 'Nuevo'
  if (status === 'hecho') return 'Hecho'
  return 'En curso'
}

function statusChipClass(status: ConversationStatus) {
  if (status === 'nuevo') return 'bg-slate-100 text-slate-600'
  if (status === 'hecho') return 'bg-emerald-50 text-emerald-800'
  return 'bg-blue-100 text-blue-800'
}

function tagChip(tag: SoftTag) {
  return (
    <span
      key={tag}
      className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900"
    >
      {tag}
    </span>
  )
}

/** Placeholder messages (reaction, contact, unsupported…) shown as a labeled notice. */
function SoftThreadNotice({ notice }: { notice: ChatMessageNotice }) {
  return (
    <div data-testid="soft-thread-notice" className={notice.tone === 'muted' ? 'text-slate-600' : undefined}>
      <p className={`flex items-center gap-1.5 font-medium ${notice.tone === 'muted' ? 'italic' : ''}`}>
        {notice.tone === 'muted' ? <Info className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
        {notice.title}
      </p>
      {notice.detail ? (
        <p className="mt-0.5 whitespace-pre-line text-[12px] leading-snug text-slate-500">{notice.detail}</p>
      ) : null}
      {notice.href ? (
        <a
          href={notice.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[12px] font-semibold text-au-ink-5b6cff underline-offset-2 hover:underline"
        >
          {notice.hrefLabel || 'Abrir'}
        </a>
      ) : null}
    </div>
  )
}

/** IG attachments have no media id; the server keeps the CDN URL and serves it by message id. */
function hasInstagramAttachment(msg: ChatInboxMessage): boolean {
  const raw = (msg.metadata as { rawMessage?: { attachments?: Array<{ hasUrl?: boolean }> } } | null | undefined)?.rawMessage
  return Boolean(raw?.attachments?.[0]?.hasUrl)
}

function messageHasMedia(msg: ChatInboxMessage): boolean {
  if (msg.providerMediaId || msg.mediaBlobPath) return true
  const type = (msg.messageType || '').toLowerCase()
  return ['image', 'audio', 'voice', 'document', 'video', 'sticker', 'file'].includes(type)
}

export function SoftThreadPane({
  conversation,
  messageInput,
  onMessageInput,
  onSend,
  sending,
  sendError,
  onClearError,
  onRetry,
  onRetryMessage,
  failedOutboundId,
  composerRef,
  onClose,
  onBack,
  messagesEndRef,
  messagesContainerRef,
  onMessagesScroll,
  showTemplateCta,
  compact,
  hasMoreMessages,
  loadingOlder,
  onLoadOlder,
  templates = [],
  templatesLoading,
  templatesError,
  showTemplatePicker,
  onOpenTemplatePicker,
  onCloseTemplatePicker,
  onSendTemplate,
  agentMode = 'human',
  onTakeOver,
  onPauseAi,
  onResumeAi,
  aiBusy,
  threadLoading,
  threadError,
  onRetryThread,
  channelDownMessage,
  onOpenDetails,
  agentActionsToday = 0,
  onCreateOrder,
  orderDraftPending,
  detailsPanel,
  assignment,
  attachments,
  quickReplies,
}: SoftThreadPaneProps) {
  const [pickerOpenLocal, setPickerOpenLocal] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingRecent, setPendingRecent] = useState<RecentMediaItem | null>(null)
  const [pendingQuickMedia, setPendingQuickMedia] = useState<QuickReplyMedia[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [slash, setSlash] = useState<{ query: string; start: number } | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  /** `false` = closed; string = open (optionally pre-filling a new shortcut). */
  const [managerOpen, setManagerOpen] = useState<false | { shortcut?: string }>(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const dragDepth = useRef(0)
  // Thumbnail for a dropped / pasted / picked image.
  const pendingPreview = useMemo(
    () => (pendingFile && pendingFile.type.startsWith('image/') ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  )
  useEffect(() => () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
  }, [pendingPreview])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const setTextareaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el
      if (typeof composerRef === 'function') composerRef(el)
      else if (composerRef && typeof composerRef === 'object') {
        ;(composerRef as { current: HTMLTextAreaElement | null }).current = el
      }
    },
    [composerRef],
  )
  useAutoGrowTextarea(textareaRef, messageInput, compact ? 160 : 240)
  const composerFocus = () => textareaRef.current?.focus()
  // Switching chats drops a file picked for another conversation.
  useEffect(() => {
    setPendingFile(null)
    setPendingRecent(null)
    setPendingQuickMedia([])
    setDropError(null)
    setDragActive(false)
    dragDepth.current = 0
    setSlash(null)
    setEmojiOpen(false)
    setAttachMenuOpen(false)
  }, [conversation?.recipientId, conversation?.socialAccountId])
  const slashMatches = useMemo(
    () => (slash && quickReplies ? filterQuickReplies(quickReplies.items, slash.query) : []),
    [slash, quickReplies],
  )
  const setCaret = (pos: number) =>
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  const insertAtCaret = (text: string) => {
    const el = textareaRef.current
    const start = el ? el.selectionStart : messageInput.length
    const end = el ? el.selectionEnd : messageInput.length
    onMessageInput(messageInput.slice(0, start) + text + messageInput.slice(end))
    setCaret(start + text.length)
  }
  const pickQuickReply = (reply: ChatQuickReply) => {
    if (!slash) return
    const next = applyQuickReply(messageInput, slash, reply, conversation?.recipientName)
    onMessageInput(next.text)
    if (next.media.length && attachments?.onSendQuickReplyMedia) {
      setPendingFile(null)
      setPendingRecent(null)
      setPendingQuickMedia(next.media)
    }
    setSlash(null)
    setCaret(next.caret)
  }
  const updateSlash = (value: string, caret: number) => {
    if (!quickReplies) return
    const next = slashQueryAt(value, caret)
    setSlash(next)
    if (next?.query !== slash?.query) setSlashIndex(0)
  }
  const submitComposer = (e: FormEvent) => {
    if (pendingQuickMedia.length && attachments?.onSendQuickReplyMedia) {
      e.preventDefault()
      const media = pendingQuickMedia
      void attachments.onSendQuickReplyMedia(media, messageInput).then((ok) => {
        if (ok) setPendingQuickMedia([])
      })
      return
    }
    if (pendingRecent && attachments?.onSendRecent) {
      e.preventDefault()
      const item = pendingRecent
      void attachments.onSendRecent(item.messageId, messageInput).then((ok) => {
        if (ok) setPendingRecent(null)
      })
      return
    }
    if (pendingFile && attachments) {
      e.preventDefault()
      const file = pendingFile
      void attachments.onSendFile(file, messageInput).then((ok) => {
        if (ok) setPendingFile(null)
      })
      return
    }
    onSend(e)
  }
  const pickerOpen = showTemplatePicker ?? pickerOpenLocal

  const renderedMessages = useMemo(
    () =>
      selectThreadRenderWindow(
        conversation?.messages ?? [],
        CHAT_INBOX_V2_THREAD_RENDER_WINDOW,
      ),
    [conversation?.messages],
  )

  if (!conversation) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center bg-au-tint-fafbfc px-6 text-center">
        <AuroraEmptyState
          icon="💬"
          title="Seleccioná un chat"
          description="Elegí una conversación para leer el hilo, responder o tomar el control del agente."
        />
        <p className="text-[11px] text-slate-400">↑↓ navegar · Enter abrir · Esc volver</p>
      </section>
    )
  }

  const windowOpen = isWhatsAppWindowOpen(conversation.messages, conversation.platform)
  const windowLabel =
    conversation.platform === 'whatsapp'
      ? windowOpen
        ? 'ventana 24h OK'
        : 'ventana 24h CERRADA'
      : null
  const channelMeta = formatThreadChannelMeta({
    id: conversation.socialAccountId,
    platform: conversation.platform,
    accountId: conversation.recipientId,
    displayName: conversation.accountLabel,
    displayPhoneNumber:
      conversation.platform === 'whatsapp' ? conversation.channelAddress : null,
    providerUsername:
      conversation.platform === 'instagram'
        ? conversation.channelAddress?.replace(/^@/, '')
        : null,
  })
  const metaLine = [channelMeta, statusLabel(conversation.status), windowLabel]
    .filter(Boolean)
    .join(' · ')

  const closedWindow = conversation.platform === 'whatsapp' && !windowOpen
  const canCreateOrder = Boolean(onCreateOrder) && !conversation.orderId && !conversation.isDemo
  // F37-03: unlock composer whenever paused / human takeover (incl. DEMO).
  const composerEnabled = isSoftHumanComposerEnabled(agentMode)
  const canAttach = Boolean(attachments) && conversation.platform === 'whatsapp' && composerEnabled && !sending

  /** Stage a dropped / pasted file like the paperclip does (preview + optional caption). */
  function stageFile(file: File) {
    if (!attachments) return
    const check = acceptsAttachment(file, attachments.accept)
    if (!check.ok) {
      setDropError(check.error)
      return
    }
    setDropError(null)
    setPendingRecent(null)
    setPendingQuickMedia([])
    setPendingFile(file)
    composerFocus()
  }
  const dropHandlers = {
    onDragEnter: (e: DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(e.dataTransfer)) return
      e.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = canAttach ? 'copy' : 'none'
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(e.dataTransfer)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(e.dataTransfer)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragActive(false)
      if (!canAttach) return
      const files = Array.from(e.dataTransfer.files || [])
      if (files.length > 1) setDropError('Se envía un archivo a la vez: tomamos el primero.')
      if (files[0]) stageFile(files[0])
    },
  }

  function openPicker() {
    onClearError()
    if (onOpenTemplatePicker) onOpenTemplatePicker()
    else setPickerOpenLocal(true)
  }

  function closePicker() {
    if (onCloseTemplatePicker) onCloseTemplatePicker()
    else setPickerOpenLocal(false)
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-white" {...dropHandlers} data-testid="soft-thread-drop-zone">
      {dragActive ? (
        <div
          className={`pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed backdrop-blur-[2px] ${
            canAttach ? 'border-[#5B6CFF] bg-au-tint-eef0ff/85 text-au-ink-4a46e5' : 'border-slate-300 bg-slate-50/90 text-slate-500'
          }`}
          data-testid="soft-thread-drop-overlay"
        >
          <Paperclip className="h-8 w-8" aria-hidden />
          <p className="text-[14px] font-semibold">
            {canAttach ? 'Soltá la imagen para adjuntarla' : conversation.platform !== 'whatsapp' ? 'Por ahora solo se envían archivos por WhatsApp' : 'Tomá control del chat para enviar archivos'}
          </p>
          {canAttach ? <p className="text-[12px] opacity-80">Foto, video, audio o documento · máx. 9 MB</p> : null}
        </div>
      ) : null}
      {channelDownMessage ? <ChannelDownBanner message={channelDownMessage} /> : null}
      {compact ? (
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white px-3 py-2.5">
          <button
            type="button"
            onClick={onBack ?? onClose}
            aria-label="Volver a chats"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-800 active:bg-slate-100"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[14px] font-bold text-blue-700">
            {initialsFromName(conversation.recipientName)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-bold leading-tight text-slate-900">
              {conversation.recipientName || conversation.recipientId}
            </h2>
            <p
              className={`mt-0.5 flex items-center gap-1.5 truncate text-[12px] ${
                closedWindow ? 'font-medium text-red-600' : 'text-slate-500'
              }`}
            >
              <ChannelLogo platform={conversation.platform} size={12} className="shrink-0" />
              <span className="truncate">
                {conversation.accountLabel}
                {closedWindow ? ' · ventana 24h cerrada' : ''}
              </span>
            </p>
          </div>
          {canCreateOrder ? (
            <button
              type="button"
              onClick={onCreateOrder}
              aria-label={orderDraftPending ? 'Continuar pedido (borrador)' : 'Crear pedido'}
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-au-tint-f1eeff text-au-ink-5b3fe0"
            >
              <ShoppingBag className="h-5 w-5" aria-hidden />
              {orderDraftPending ? (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white" aria-hidden />
              ) : null}
            </button>
          ) : null}
          {onOpenDetails ? (
            <button
              type="button"
              onClick={onOpenDetails}
              aria-label="Detalles del chat"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-au-tint-f1efea text-slate-800"
            >
              <User className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </header>
      ) : null}
      {compact && assignment && !conversation.isDemo ? (
        <div
          className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white px-3 py-1.5"
          data-testid="soft-thread-mobile-owner"
        >
          <span className="text-[12px] text-slate-500">Responsable</span>
          <ChatAssigneePicker
            compact
            current={conversation.assignee}
            assignees={assignment.assignees}
            viewerUserId={assignment.viewerUserId}
            onAssign={assignment.onAssign}
            busy={assignment.busy}
          />
        </div>
      ) : null}
      {!compact ? (
        <header className="shrink-0 border-b border-slate-200/70 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="mb-1 text-xs font-medium text-au-ink-5b6cff"
                >
                  ← Chats
                </button>
              ) : null}
              <h2 className="truncate text-base font-semibold text-slate-900">
                {conversation.recipientName || conversation.recipientId}
              </h2>
              <p
                className={`mt-0.5 flex items-center gap-1.5 truncate text-[11px] ${
                  closedWindow ? 'font-medium text-red-600' : 'text-slate-500'
                }`}
              >
                <ChannelLogo platform={conversation.platform} size={16} className="shrink-0" />
                <span className="truncate">
                  {compact && closedWindow
                    ? `${platformFullName(conversation.platform)} · ${conversation.accountLabel} · ventana 24h CERRADA`
                    : metaLine}
                </span>
              </p>
              <p className="mt-1 truncate text-[11px] text-slate-500" data-testid="soft-agent-label">
                {conversation.agentLabel || 'Sin agente'}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${statusChipClass(conversation.status)}`}
                >
                  {statusLabel(conversation.status)}
                </span>
                <span className="rounded-md bg-au-tint-eef0ff px-2 py-0.5 text-[10px] font-medium text-au-ink-4a46e5">
                  {agentModeLabel(agentMode)}
                </span>
                {conversation.tags.map(tagChip)}
              </div>
            </div>
            {!compact ? (
              <div className="flex shrink-0 items-center gap-2">
                {assignment && !conversation.isDemo ? (
                  <ChatAssigneePicker
                    current={conversation.assignee}
                    assignees={assignment.assignees}
                    viewerUserId={assignment.viewerUserId}
                    onAssign={assignment.onAssign}
                    busy={assignment.busy}
                  />
                ) : null}
                {conversation.orderId ? (
                  <Link
                    href={`/ventas?pedido=${encodeURIComponent(conversation.orderId)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                    data-testid="soft-thread-order-link"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Pedido vinculado
                    {conversation.orderNumber ? (
                      <span className="font-semibold">#{conversation.orderNumber}</span>
                    ) : null}
                  </Link>
                ) : canCreateOrder ? (
                  <button
                    type="button"
                    onClick={onCreateOrder}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90"
                    data-testid="soft-thread-create-order"
                  >
                    <ShoppingBag className="h-3.5 w-3.5" aria-hidden />
                    {orderDraftPending ? 'Continuar pedido' : 'Crear pedido'}
                    {orderDraftPending ? (
                      <span className="rounded bg-static-white/25 px-1.5 py-px text-[10px] font-semibold">Borrador</span>
                    ) : null}
                  </button>
                ) : null}
                {detailsPanel ? (
                  <button
                    type="button"
                    onClick={detailsPanel.onToggle}
                    aria-pressed={detailsPanel.open}
                    aria-label={detailsPanel.open ? 'Ocultar detalles' : 'Mostrar detalles'}
                    title={`${detailsPanel.open ? 'Ocultar' : 'Mostrar'} detalles  ( ] )`}
                    className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg ring-1 transition-colors ${
                      detailsPanel.open
                        ? 'bg-au-tint-eef0ff text-au-ink-4a46e5 ring-[#5B6CFF]/25'
                        : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                    data-testid="toggle-details-panel"
                  >
                    <PanelRight className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  Cerrar
                </button>
              </div>
            ) : null}
          </div>
        </header>
      ) : null}

      {compact ? (
        <div className="shrink-0 bg-au-tint-f5f4f0 px-3 pt-3" data-testid="soft-agent-banner">
          <div className="rounded-2xl bg-gradient-to-r from-[#5B6CFF] via-[#A855F7] to-[#EC4899] p-[1.5px]">
            <div className="flex items-center gap-3 rounded-[14.5px] bg-white px-3 py-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B6CFF] to-[#EC4899] text-white">
                <Sparkles className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-slate-900">
                  {agentMode === 'ai_active'
                    ? `${conversation.agentLabel || 'Agente'} está atendiendo`
                    : agentMode === 'paused'
                      ? 'Agente en pausa'
                      : 'Control humano'}
                </p>
                <p className="truncate text-[12px] text-slate-500">
                  {agentModeLabel(agentMode)}
                  {aiBusy ? ' · procesando…' : ` · ${agentActionsToday} ${agentActionsToday === 1 ? 'acción' : 'acciones'} hoy`}
                </p>
              </div>
              {agentMode === 'ai_active' ? (
                <button
                  type="button"
                  onClick={onPauseAi}
                  disabled={aiBusy}
                  aria-label="Pausar agente"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-800 ring-1 ring-slate-200 disabled:opacity-50"
                >
                  <Pause className="h-4 w-4" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onResumeAi}
                  disabled={aiBusy}
                  aria-label="Reanudar IA"
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-[13px] font-semibold text-emerald-800 ring-1 ring-emerald-200 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" aria-hidden />
                  Reanudar
                </button>
              )}
              {agentMode !== 'human' ? (
                <button
                  type="button"
                  onClick={onTakeOver}
                  disabled={aiBusy}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] px-3.5 text-[14px] font-semibold text-white disabled:opacity-50"
                >
                  <Hand className="h-4 w-4" aria-hidden />
                  Tomar
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={messagesContainerRef}
        onScroll={onMessagesScroll}
        className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5 ${
          compact ? 'bg-au-tint-f5f4f0' : 'bg-au-tint-fafbfc'
        }`}
      >
        {hasMoreMessages && onLoadOlder ? (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-100 hover:bg-slate-100 disabled:opacity-50"
            >
              {loadingOlder ? 'Cargando…' : 'Cargar anteriores'}
            </button>
          </div>
        ) : null}

        {renderedMessages.length === 0 && threadLoading ? (
          <AuroraThreadSkeleton />
        ) : renderedMessages.length === 0 && threadError ? (
          <AuroraErrorState
            title="No pudimos cargar los mensajes"
            description="La conversación sigue ahí; solo falló la consulta."
            onRetry={onRetryThread}
          />
        ) : renderedMessages.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400">Sin mensajes en este chat</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Los mensajes nuevos aparecen acá apenas lleguen.
            </p>
          </div>
        ) : (
          renderedMessages.map((msg) => {
            const outbound = msg.direction === 'outbound'
            const failed = failedOutboundId === msg.id
            const softAi =
              Boolean(msg.id?.startsWith('demo-ai-')) ||
              isSoftAiOutboundMetadata(msg.metadata)
            const showMedia = messageHasMedia(msg)
            // Any stored `[type]` token (media, share, story_mention, ig_reel…) is never shown
            // as text next to the media (it stays after IG media gets cached).
            const isPlaceholder = showMedia && isPlaceholderToken(msg.content)
            const mediaFetchable = showMedia && Boolean(msg.providerMediaId || msg.mediaBlobPath || hasInstagramAttachment(msg))
            const notice = showMedia ? null : describeChatMessage(msg)
            const humanSender = !softAi && outbound ? humanOutboundSender(msg.metadata) : null
            const humanLabel = humanSender ? humanOutboundLabel(msg.metadata) : null
            return (
              <div
                key={msg.id}
                data-testid="soft-thread-message"
                className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex items-end gap-2 ${compact ? 'max-w-[82%]' : 'max-w-[85%] sm:max-w-md'} ${outbound ? 'flex-row-reverse' : ''}`}>
                  {humanSender?.name ? (
                    humanSender.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={humanSender.image}
                        alt={humanSender.name}
                        referrerPolicy="no-referrer"
                        className="mb-5 h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                        data-testid="soft-thread-sender-avatar"
                      />
                    ) : (
                      <div
                        className="mb-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white"
                        data-testid="soft-thread-sender-avatar"
                        aria-hidden
                      >
                        {humanSender.name.slice(0, 1).toUpperCase()}
                      </div>
                    )
                  ) : null}
                  <div>
                  <div
                    className={`rounded-[14px] px-3.5 py-2.5 ${compact ? 'text-[15px] leading-snug' : 'text-[13px]'} ${
                      outbound
                        ? softAi
                          ? 'bg-au-tint-f0eeff text-slate-900 ring-1 ring-[#5B6CFF]/15'
                          : 'bg-au-tint-e8f0fe text-slate-900 ring-1 ring-blue-200/60'
                        : 'bg-white text-slate-900 ring-1 ring-slate-200/80'
                    }`}
                  >
                    {mediaFetchable ? <ChatMediaBubble msg={msg} outbound={outbound} /> : null}
                    {notice ? (
                      <SoftThreadNotice notice={notice} />
                    ) : !isPlaceholder ? (
                      <p className={`whitespace-pre-wrap break-words ${showMedia ? 'mt-1' : ''}`}>{msg.content}</p>
                    ) : null}
                    {showMedia && isPlaceholder && !mediaFetchable ? (
                      <p className="text-[11px] opacity-70">Adjunto no disponible</p>
                    ) : null}
                    {compact ? (
                      <p
                        className={`mt-1 flex items-center gap-1 text-[11px] ${
                          outbound ? 'justify-start text-au-ink-5b3fe0' : 'text-slate-400'
                        }`}
                        data-testid="soft-thread-message-meta"
                      >
                        {outbound && softAi ? (
                          <>
                            <Sparkles className="h-3 w-3" aria-hidden />
                            <span className="font-medium">{conversation.agentLabel || 'Agente'}</span>
                            <span aria-hidden>·</span>
                          </>
                        ) : null}
                        <span className={outbound && !softAi ? 'text-slate-500' : undefined}>
                          {humanLabel ? `${humanLabel} · ` : null}
                          {formatMessageTime(msg.sentAt)}
                        </span>
                        {outbound ? <DeliveryTicks status={msg.deliveryStatus} /> : null}
                      </p>
                    ) : null}
                  </div>
                  {outbound && (!compact || failed || msg.deliveryStatus === 'failed') ? (
                    <p
                      className={`mt-1 text-right text-[10px] ${
                        failed || msg.deliveryStatus === 'failed'
                          ? 'font-medium text-red-600'
                          : 'text-slate-500'
                      }`}
                      data-testid="soft-thread-outbound-attribution"
                    >
                      {softAi ? (
                        msg.id?.startsWith('demo-ai-')
                          ? 'IA envió'
                          : softAiOutboundLabel(msg.metadata)
                      ) : failed || msg.deliveryStatus === 'failed' ? (
                        <>
                          No enviado ⓘ{' '}
                          <button
                            type="button"
                            onClick={() => {
                              if (onRetryMessage) onRetryMessage(msg.id)
                              else onRetry?.()
                            }}
                            className="font-semibold text-au-ink-5b6cff underline-offset-2 hover:underline"
                          >
                            Reintentar
                          </button>
                          {' · '}
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(msg.content || '')
                            }}
                            className="text-slate-500 underline-offset-2 hover:underline"
                          >
                            Copiar texto
                          </button>
                        </>
                      ) : (
                        <>
                          {humanLabel ? `${humanLabel} · ` : null}
                          {outboundDeliveryLabel(msg.deliveryStatus)}
                        </>
                      )}
                    </p>
                  ) : null}
                  </div>
                </div>
              </div>
            )
          })
        )}

        {compact && conversation.orderId ? (
          <div className="flex justify-center" data-testid="soft-thread-order-chip">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-slate-800 ring-1 ring-emerald-200">
              <Check className="h-4 w-4 rounded-full bg-emerald-500 p-0.5 text-white" aria-hidden />
              Pedido vinculado
              {conversation.orderNumber ? (
                <span className="font-semibold text-slate-900">#{conversation.orderNumber}</span>
              ) : null}
              <Link href={`/ventas?pedido=${encodeURIComponent(conversation.orderId)}`} className="font-semibold text-au-ink-5b3fe0">
                Ver
              </Link>
            </span>
          </div>
        ) : null}

        {conversation.pendingSuggestionText ? (
          <div
            className="rounded-2xl bg-au-tint-f0eeff px-4 py-3 text-[12px] text-slate-900 ring-1 ring-[#5B6CFF]/15"
            data-testid="soft-ai-suggestion"
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              Sugerencia del agente
            </p>
            <p className="whitespace-pre-wrap">{conversation.pendingSuggestionText}</p>
            <p className="mt-2 text-[10px] text-violet-600">
              Solo lectura por ahora: usá el texto como referencia al responder.
            </p>
          </div>
        ) : null}

        {conversation.isDemo ? (
          <div className="rounded-[14px] bg-amber-50 px-4 py-2.5 text-[11px] text-amber-900 ring-1 ring-amber-100">
            Chat <span className="font-semibold">DEMO</span> · local · sin conexión a Meta · quitalo
            desde la lista
          </div>
        ) : null}

        <div
          className={`sticky bottom-0 rounded-2xl bg-white px-4 py-3 text-[12px] text-slate-800 shadow-[0_-6px_16px_rgba(250,251,252,0.9)] ring-1 ring-[#5B6CFF]/30 ${
            compact ? 'hidden' : ''
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-slate-900">
              Agente · {agentModeLabel(agentMode)}
              {aiBusy ? ' · procesando…' : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={agentMode === 'paused'}
                onClick={onPauseAi}
                className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
              >
                Pausar
              </button>
              <button
                type="button"
                disabled={agentMode === 'human'}
                onClick={onTakeOver}
                className="rounded-lg bg-[#5B6CFF] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#4A5AF0] disabled:opacity-40"
              >
                Tomar control
              </button>
              <button
                type="button"
                disabled={agentMode === 'ai_active'}
                onClick={onResumeAi}
                className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-100 hover:bg-emerald-100 disabled:opacity-40"
              >
                Reanudar IA
              </button>
            </div>
          </div>
          <p className="mt-1.5 leading-relaxed text-slate-500">
            {agentMode === 'ai_active'
              ? 'El agente responde solo. Pausalo o tomá el control para intervenir.'
              : agentMode === 'paused'
                ? 'Agente en pausa — no responde solo. Podés escribir vos o reanudarlo.'
                : 'Control humano — el agente no responde hasta que lo reanudes.'}
          </p>
        </div>

        <div ref={messagesEndRef} />
      </div>

      {closedWindow || showTemplateCta ? (
        <div className="shrink-0 border-t border-slate-200/70 px-4 py-4 sm:px-5">
          <div className="rounded-2xl bg-red-50 px-4 py-4 text-center">
            <p className="text-sm font-semibold text-red-800">Ventana de 24h cerrada</p>
            <p className="mt-1 text-xs text-red-700">
              Solo plantilla aprobada hasta que escriba de nuevo.
            </p>
            <button
              type="button"
              className="mt-3 rounded-xl bg-[#5B6CFF] px-4 py-2.5 text-sm font-medium text-white"
              onClick={openPicker}
            >
              Elegir plantilla…
            </button>

            {pickerOpen ? (
              <div className="mt-3 rounded-xl bg-white px-3 py-3 text-left ring-1 ring-red-100">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-slate-800">Plantillas aprobadas</p>
                  <button
                    type="button"
                    onClick={closePicker}
                    className="text-[11px] text-slate-500 hover:text-slate-700"
                  >
                    Cerrar
                  </button>
                </div>
                {templatesLoading ? (
                  <p className="text-[12px] text-slate-500">Cargando catálogo…</p>
                ) : null}
                {templatesError ? (
                  <p className="text-[12px] text-red-600">{templatesError}</p>
                ) : null}
                {!templatesLoading && !templatesError && templates.length === 0 ? (
                  <p className="text-[12px] text-slate-500">
                    No hay plantillas APPROVED en esta WABA.
                  </p>
                ) : null}
                <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                  {templates.map((tpl) => (
                    <li key={`${tpl.name}:${tpl.language}`}>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => onSendTemplate?.(tpl)}
                        className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-left text-[12px] text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <span className="font-medium">{tpl.name}</span>
                        <span className="text-[10px] uppercase text-slate-400">
                          {tpl.language}
                          {tpl.category ? ` · ${tpl.category}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-red-600/80">
                Elegí una plantilla aprobada de Meta para reabrir el chat, o pedile al cliente que
                escriba de nuevo.
              </p>
            )}
          </div>
          {sendError ? (
            <div
              role="alert"
              className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-red-700"
            >
              {sendError.includes('plantilla') || sendError.includes('24')
                ? 'No se pudo enviar. Usá plantilla.'
                : sendError}
              {chatSendErrorNeedsReconnect(sendError) ? (
                <>
                  {' '}
                  <a href="/config?tab=social" className="font-semibold underline underline-offset-2">
                    Reconectar
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className={`shrink-0 border-t border-slate-200/70 bg-white px-4 py-3 sm:px-5 ${
            compact ? 'pb-[max(0.75rem,env(safe-area-inset-bottom))]' : ''
          }`}
        >
          {!composerEnabled && !compact ? (
            <p className="mb-2 text-[11px] text-slate-500">
              El agente está respondiendo — usá Tomar control o Pausar para escribir vos.
            </p>
          ) : null}

          {sendError ? (
            <div
              role="alert"
              className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {sendError}
              {chatSendErrorNeedsReconnect(sendError) ? (
                <>
                  {' '}
                  <a href="/config?tab=social" className="font-semibold underline underline-offset-2">
                    Reconectar
                  </a>
                </>
              ) : null}
            </div>
          ) : null}

          {dropError ? (
            <p role="alert" className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-testid="composer-drop-error">
              {dropError}
            </p>
          ) : null}
          {pendingQuickMedia.length ? (
            <div
              className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-700 ring-1 ring-slate-200"
              data-testid="composer-quick-media"
            >
              <span className="flex shrink-0 gap-1">
                {pendingQuickMedia.map((m) => (
                  <QuickReplyMediaThumb key={m.path} media={m} className="h-9 w-9" />
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {pendingQuickMedia.length === 1 ? pendingQuickMedia[0].filename : `${pendingQuickMedia.length} archivos de la respuesta rápida`}
              </span>
              <button
                type="button"
                onClick={() => setPendingQuickMedia([])}
                disabled={sending}
                aria-label="Quitar archivos"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
          {pendingFile || pendingRecent ? (
            <div
              className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-700 ring-1 ring-slate-200"
              data-testid="composer-attachment"
            >
              {pendingRecent ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/chat/media/${encodeURIComponent(pendingRecent.messageId)}`}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
                />
              ) : (
                pendingPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pendingPreview} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-slate-200" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                )
              )}
              <span className="min-w-0 flex-1 truncate">
                {pendingRecent ? pendingRecent.filename || 'Imagen reciente' : pendingFile?.name}
              </span>
              {pendingFile ? (
                <span className="shrink-0 text-slate-500">{(pendingFile.size / (1024 * 1024)).toFixed(1)} MB</span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setPendingFile(null)
                  setPendingRecent(null)
                  setDropError(null)
                }}
                disabled={sending}
                aria-label="Quitar archivo"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}

          <form onSubmit={submitComposer} className="relative flex items-end gap-2">
            {slash && quickReplies ? (
              <QuickReplySuggestions
                items={slashMatches}
                activeIndex={Math.min(slashIndex, Math.max(0, slashMatches.length - 1))}
                query={slash.query}
                onPick={pickQuickReply}
                onHover={setSlashIndex}
                onManage={() => {
                  setManagerOpen(slashMatches.length ? {} : { shortcut: slash.query })
                  setSlash(null)
                }}
              />
            ) : null}
            {emojiOpen ? (
              <EmojiPickerPopover onPick={(emoji) => insertAtCaret(emoji)} onClose={() => setEmojiOpen(false)} />
            ) : null}
            {attachMenuOpen && attachments ? (
              <RecentMediaPopover
                sending={sending}
                onClose={() => setAttachMenuOpen(false)}
                onUpload={() => {
                  setAttachMenuOpen(false)
                  fileInputRef.current?.click()
                }}
                onPick={(item) => {
                  setAttachMenuOpen(false)
                  setPendingFile(null)
                  setPendingQuickMedia([])
                  setPendingRecent(item)
                  composerFocus()
                }}
              />
            ) : null}
            <div className="flex shrink-0 items-center gap-0.5 pb-1">
              <button
                type="button"
                data-popover-toggle
                onClick={() => {
                  setAttachMenuOpen(false)
                  setEmojiOpen((v) => !v)
                }}
                disabled={sending || !composerEnabled}
                aria-label="Emojis"
                aria-expanded={emojiOpen}
                title="Emojis"
                className={`flex items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] disabled:opacity-40 ${
                  compact ? 'h-10 w-9' : 'h-9 w-9'
                } ${emojiOpen ? 'bg-slate-100 text-au-ink-5b6cff' : ''}`}
                data-testid="composer-emoji"
              >
                <Smile className="h-5 w-5" aria-hidden />
              </button>
              {quickReplies && !compact ? (
                <button
                  type="button"
                  onClick={() => setManagerOpen({})}
                  disabled={!composerEnabled}
                  aria-label="Respuestas rápidas"
                  title="Respuestas rápidas (escribí / en el mensaje)"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] disabled:opacity-40"
                  data-testid="composer-quick-replies-button"
                >
                  <Zap className="h-[18px] w-[18px]" aria-hidden />
                </button>
              ) : null}
              {attachments && conversation.platform === 'whatsapp' ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={attachments.accept}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null
                      setPendingFile(file)
                      if (file) setPendingQuickMedia([])
                      if (file) setPendingRecent(null)
                      e.target.value = ''
                      if (file) composerFocus()
                    }}
                  />
                  <button
                    type="button"
                    data-popover-toggle
                    onClick={() => {
                      setEmojiOpen(false)
                      if (attachments.onSendRecent) setAttachMenuOpen((v) => !v)
                      else fileInputRef.current?.click()
                    }}
                    disabled={sending || !composerEnabled}
                    aria-label="Adjuntar archivo"
                    aria-expanded={attachMenuOpen}
                    title="Adjuntar foto, video, audio o documento"
                    className={`flex items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] disabled:opacity-40 ${
                      compact ? 'h-10 w-9' : 'h-9 w-9'
                    } ${attachMenuOpen ? 'bg-slate-100 text-au-ink-5b6cff' : ''}`}
                    data-testid="composer-attach"
                  >
                    <Paperclip className="h-5 w-5" aria-hidden />
                  </button>
                </>
              ) : null}
            </div>
            <textarea
              ref={setTextareaRef}
              rows={1}
              value={messageInput}
              onChange={(e) => {
                onMessageInput(e.target.value)
                updateSlash(e.target.value, e.target.selectionStart)
                if (sendError) onClearError()
              }}
              onSelect={(e) => updateSlash(e.currentTarget.value, e.currentTarget.selectionStart)}
              onBlur={() => setSlash(null)}
              onPaste={(e) => {
                // Screenshot / copied image: attach it instead of pasting nothing.
                const file = fileFromClipboard(e.clipboardData)
                if (!file || !canAttach) return
                e.preventDefault()
                stageFile(file)
              }}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (slash && quickReplies) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    e.stopPropagation()
                    const n = Math.max(1, slashMatches.length)
                    setSlashIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    // Never send a half-typed "/atajo" to the customer.
                    if (e.key === 'Tab' && !slashMatches.length) return
                    e.preventDefault()
                    e.stopPropagation()
                    if (slashMatches.length) pickQuickReply(slashMatches[Math.min(slashIndex, slashMatches.length - 1)])
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setSlash(null)
                    return
                  }
                }
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
                e.preventDefault()
                if (sending || !composerEnabled || (!messageInput.trim() && !pendingFile && !pendingRecent && !pendingQuickMedia.length)) return
                submitComposer(e as unknown as FormEvent)
              }}
              aria-label={pendingFile || pendingRecent ? 'Texto del archivo (opcional)' : 'Mensaje'}
              placeholder={
                pendingFile || pendingRecent
                  ? pendingFile && /\.(mp3|m4a|aac|amr|ogg|opus)$/i.test(pendingFile.name)
                    ? 'Los audios se envían sin texto'
                    : 'Agregá un texto al archivo (opcional)'
                  : composerEnabled
                  ? compact
                    ? 'Escribí un mensaje'
                    : quickReplies
                    ? 'Escribí un mensaje… / para respuestas rápidas'
                    : 'Escribí un mensaje… Enter envía · Shift+Enter nueva línea'
                  : 'Tomá control o pausá el agente para escribir'
              }
              disabled={sending || !composerEnabled}
              data-testid="composer-textarea"
              className={
                compact
                  ? 'min-h-[44px] min-w-0 flex-1 resize-none overflow-hidden rounded-3xl border-0 bg-au-tint-f1efea px-4 py-3 text-[16px] leading-snug text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-[#5B6CFF]/35 disabled:opacity-60'
                  : 'min-h-[46px] min-w-0 flex-1 resize-none overflow-hidden rounded-xl border-0 bg-slate-50 px-3.5 py-3 text-[13px] leading-[1.45] text-slate-900 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5B6CFF]/35 disabled:opacity-60'
              }
            />
            <button
              type="submit"
              aria-label="Enviar"
              disabled={sending || (!messageInput.trim() && !pendingFile && !pendingRecent && !pendingQuickMedia.length) || !composerEnabled}
              className={
                compact
                  ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B6CFF] to-[#7C5CFF] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
                  : 'h-[46px] shrink-0 rounded-xl bg-[#5B6CFF] px-4 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50'
              }
            >
              {compact ? <Send className="h-5 w-5" aria-hidden /> : sending ? '…' : 'Enviar'}
            </button>
          </form>
          {!compact ? (
            <p className="mt-2 text-[11px] text-slate-400">
              Enter envía · Shift+Enter nueva línea{quickReplies ? ' · / respuestas rápidas' : ''} · Esc cierra · ↑↓ lista
            </p>
          ) : null}
          {managerOpen && quickReplies ? (
            <QuickRepliesManager
              items={quickReplies.items}
              onSave={quickReplies.onSave}
              canManage={quickReplies.canManage === true}
              initialShortcut={quickReplies.canManage ? managerOpen.shortcut : undefined}
              onClose={() => {
                setManagerOpen(false)
                composerFocus()
              }}
            />
          ) : null}
        </div>
      )}
    </section>
  )
}
