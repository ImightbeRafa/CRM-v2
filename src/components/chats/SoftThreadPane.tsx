'use client'

import {
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react'
import Link from 'next/link'
import { Check, CheckCheck, ChevronLeft, Hand, Pause, Play, Send, Sparkles, User } from 'lucide-react'
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
import { ChannelLogo } from '@/components/social/ChannelLogo'
import {
  AuroraEmptyState,
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
  /** Selected line is down / needs repair (STATE-01 canal caído). */
  channelDownMessage?: string | null
  /** Mobile (compact): open the details / status sheet (CHAT-M02 person button). */
  onOpenDetails?: () => void
  /** Mobile (compact): agent tool actions logged today, shown in the agent banner. */
  agentActionsToday?: number
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
      className={`h-3 w-3 ${status === 'read' ? 'text-[#5B3FE0]' : 'text-slate-400'}`}
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

function messageHasMedia(msg: ChatInboxMessage): boolean {
  if (msg.providerMediaId || msg.mediaBlobPath) return true
  const type = (msg.messageType || '').toLowerCase()
  return ['image', 'audio', 'voice', 'document', 'video', 'sticker'].includes(type)
}

function SoftThreadMedia({ msg }: { msg: ChatInboxMessage }) {
  const src = `/api/chat/media/${encodeURIComponent(msg.id)}`
  const mime = (msg.mediaMimeType || '').toLowerCase()
  const type = (msg.messageType || '').toLowerCase()

  if (type === 'image' || mime.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={msg.content || 'imagen'}
        className="mt-1 max-h-64 max-w-full rounded-lg object-contain"
        loading="lazy"
      />
    )
  }
  if (type === 'audio' || type === 'voice' || mime.startsWith('audio/')) {
    return <audio controls preload="none" src={src} className="mt-1 w-full max-w-xs" />
  }
  if (type === 'document' || mime.includes('pdf') || Boolean(msg.mediaFilename)) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium underline underline-offset-2"
      >
        {msg.mediaFilename || 'Documento'}
      </a>
    )
  }
  if (type === 'video' || mime.startsWith('video/')) {
    return <video controls preload="none" src={src} className="mt-1 max-h-64 max-w-full rounded-lg" />
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-flex text-[12px] font-medium underline underline-offset-2"
    >
      Ver archivo
    </a>
  )
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
  agentMode = 'ai_active',
  onTakeOver,
  onPauseAi,
  onResumeAi,
  aiBusy,
  threadLoading,
  channelDownMessage,
  onOpenDetails,
  agentActionsToday = 0,
}: SoftThreadPaneProps) {
  const [pickerOpenLocal, setPickerOpenLocal] = useState(false)
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
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[#FAFBFC] px-6 text-center">
        <AuroraEmptyState
          icon="💬"
          title="Seleccioná un chat"
          description="Elegí una conversación para leer el hilo, responder o tomar el control del agente."
        />
        <p className="text-[11px] text-slate-400">↑↓ navegar · Enter abrir · Esc volver · ⌘K buscar</p>
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
  // F37-03: unlock composer whenever paused / human takeover (incl. DEMO).
  const composerEnabled = isSoftHumanComposerEnabled(agentMode)

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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
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
          {onOpenDetails ? (
            <button
              type="button"
              onClick={onOpenDetails}
              aria-label="Detalles del chat"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F1EFEA] text-slate-800"
            >
              <User className="h-5 w-5" aria-hidden />
            </button>
          ) : null}
        </header>
      ) : (
        <header className="shrink-0 border-b border-slate-200/70 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="mb-1 text-xs font-medium text-[#5B6CFF]"
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
                <span className="rounded-md bg-[#EEF0FF] px-2 py-0.5 text-[10px] font-medium text-[#4A46E5]">
                  {agentModeLabel(agentMode)}
                </span>
                {conversation.tags.map(tagChip)}
              </div>
            </div>
            {!compact ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Cerrar
              </button>
            ) : null}
          </div>
        </header>
      )}

      {compact ? (
        <div className="shrink-0 bg-[#F5F4F0] px-3 pt-3" data-testid="soft-agent-banner">
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
          compact ? 'bg-[#F5F4F0]' : 'bg-[#FAFBFC]'
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
            const isPlaceholder =
              showMedia &&
              (msg.content === '[image]' ||
                msg.content === '[audio]' ||
                msg.content === '[voice]' ||
                msg.content === '[document]' ||
                msg.content === '[video]' ||
                msg.content === '[sticker]')
            return (
              <div
                key={msg.id}
                data-testid="soft-thread-message"
                className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
              >
                <div className={compact ? 'max-w-[82%]' : 'max-w-[85%] sm:max-w-md'}>
                  <div
                    className={`rounded-[14px] px-3.5 py-2.5 ${compact ? 'text-[15px] leading-snug' : 'text-[13px]'} ${
                      outbound
                        ? softAi
                          ? 'bg-[#F0EEFF] text-slate-900 ring-1 ring-[#5B6CFF]/15'
                          : 'bg-[#E8F0FE] text-slate-900 ring-1 ring-blue-200/60'
                        : 'bg-white text-slate-900 ring-1 ring-slate-200/80'
                    }`}
                  >
                    {showMedia ? <SoftThreadMedia msg={msg} /> : null}
                    {!isPlaceholder ? (
                      <p className={showMedia ? 'mt-1' : undefined}>{msg.content}</p>
                    ) : null}
                    {showMedia && isPlaceholder && !msg.providerMediaId && !msg.mediaBlobPath ? (
                      <p className="text-[11px] opacity-70">Adjunto no disponible</p>
                    ) : null}
                    {compact ? (
                      <p
                        className={`mt-1 flex items-center gap-1 text-[11px] ${
                          outbound ? 'justify-start text-[#5B3FE0]' : 'text-slate-400'
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
                            className="font-semibold text-[#5B6CFF] underline-offset-2 hover:underline"
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
                        outboundDeliveryLabel(msg.deliveryStatus)
                      )}
                    </p>
                  ) : null}
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
              <Link href="/ventas" className="font-semibold text-[#5B3FE0]">
                Ver
              </Link>
            </span>
          </div>
        ) : null}

        {conversation.pendingSuggestionText ? (
          <div
            className="rounded-2xl bg-[#F0EEFF] px-4 py-3 text-[12px] text-slate-900 ring-1 ring-[#5B6CFF]/15"
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

          <form onSubmit={onSend} className={compact ? 'flex items-end gap-2' : 'flex gap-2'}>
            <textarea
              ref={composerRef}
              rows={1}
              value={messageInput}
              onChange={(e) => {
                onMessageInput(e.target.value)
                if (sendError) onClearError()
              }}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key !== 'Enter' || e.shiftKey) return
                e.preventDefault()
                if (sending || !composerEnabled || !messageInput.trim()) return
                onSend(e as unknown as FormEvent)
              }}
              placeholder={
                composerEnabled
                  ? compact
                    ? 'Escribí un mensaje'
                    : 'Escribí un mensaje… Enter envía · Shift+Enter nueva línea'
                  : 'Tomá control o pausá el agente para escribir'
              }
              disabled={sending || !composerEnabled}
              className={
                compact
                  ? 'max-h-28 min-w-0 flex-1 resize-none rounded-3xl border-0 bg-[#F1EFEA] px-4 py-3 text-[16px] leading-snug text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-[#5B6CFF]/35 disabled:opacity-60'
                  : 'min-w-0 flex-1 resize-none rounded-xl border-0 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-900 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5B6CFF]/35 disabled:opacity-60'
              }
            />
            <button
              type="submit"
              aria-label="Enviar"
              disabled={sending || !messageInput.trim() || !composerEnabled}
              className={
                compact
                  ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B6CFF] to-[#7C5CFF] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
                  : 'shrink-0 rounded-xl bg-[#5B6CFF] px-4 py-3 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50'
              }
            >
              {compact ? <Send className="h-5 w-5" aria-hidden /> : sending ? '…' : 'Enviar'}
            </button>
          </form>
          {!compact ? (
            <p className="mt-2 text-[11px] text-slate-400">
              Enter envía · Shift+Enter nueva línea · ⌘K busca · Esc cierra · ↑↓ lista
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
