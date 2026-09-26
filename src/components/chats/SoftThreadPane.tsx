'use client'

import {
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react'
import {
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
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white px-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e8ecff] text-lg font-semibold text-[#5b6cff]">
          ⌘
        </div>
        <p className="text-base font-medium text-slate-700">Seleccioná un chat</p>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Elegí una conversación para monitorear la IA, ver el log de tools o tomar el control.
        </p>
        <p className="mt-3 text-[11px] text-slate-400">
          ↑↓ navegar · Enter abrir · Esc volver · ⌘K buscar
        </p>
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
  // F37-03: unlock composer whenever paused / human takeover (incl. Soft DEMO).
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
      <header className="shrink-0 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="mb-1 text-xs font-medium text-[#5b6cff]"
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
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                {agentModeLabel(agentMode)}
              </span>
              {conversation.tags.map(tagChip)}
            </div>
          </div>
          {!compact ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200"
            >
              Cerrar
            </button>
          ) : null}
        </div>
      </header>

      <div
        ref={messagesContainerRef}
        onScroll={onMessagesScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5"
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

        {renderedMessages.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400">Sin mensajes en este chat</p>
            <p className="mt-1 text-[11px] text-slate-400">
              La IA responde cuando llegue el primer inbound.
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
            const humanSender = !softAi && outbound ? humanOutboundSender(msg.metadata) : null
            const humanLabel = humanSender ? humanOutboundLabel(msg.metadata) : null
            return (
              <div
                key={msg.id}
                data-testid="soft-thread-message"
                className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex max-w-[85%] items-end gap-2 sm:max-w-md ${outbound ? 'flex-row-reverse' : ''}`}>
                  {humanSender?.name ? (
                    humanSender.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={humanSender.image}
                        alt={humanSender.name}
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
                    className={`rounded-[14px] px-3.5 py-2.5 text-[13px] ${
                      outbound
                        ? softAi
                          ? 'bg-indigo-100 text-indigo-950'
                          : 'bg-blue-100 text-blue-950'
                        : 'bg-slate-100 text-slate-900'
                    }`}
                  >
                    {showMedia ? <SoftThreadMedia msg={msg} /> : null}
                    {!isPlaceholder ? (
                      <p className={showMedia ? 'mt-1' : undefined}>{msg.content}</p>
                    ) : null}
                    {showMedia && isPlaceholder && !msg.providerMediaId && !msg.mediaBlobPath ? (
                      <p className="text-[11px] opacity-70">Adjunto no disponible</p>
                    ) : null}
                  </div>
                  {outbound ? (
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
                          Falló ✕{' '}
                          <button
                            type="button"
                            onClick={() => {
                              if (onRetryMessage) onRetryMessage(msg.id)
                              else onRetry?.()
                            }}
                            className="underline underline-offset-2"
                          >
                            Reintentar
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

        {conversation.pendingSuggestionText ? (
          <div
            className="rounded-[14px] bg-violet-50 px-4 py-3 text-[12px] text-violet-950 ring-1 ring-violet-100"
            data-testid="soft-ai-suggestion"
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              Sugerencia de IA
            </p>
            <p className="whitespace-pre-wrap">{conversation.pendingSuggestionText}</p>
            <p className="mt-2 text-[10px] text-violet-600">
              Solo lectura en A1 — Usar / Editar / Descartar llegan en A3.
            </p>
          </div>
        ) : null}

        {conversation.isDemo ? (
          <div className="rounded-[14px] bg-amber-50 px-4 py-2.5 text-[11px] text-amber-900 ring-1 ring-amber-100">
            Chat <span className="font-semibold">DEMO</span> · local · IA sin Meta · quitalo desde
            la lista
          </div>
        ) : null}

        <div className="sticky bottom-0 rounded-[14px] bg-indigo-50/95 px-4 py-3 text-[12px] text-indigo-950 shadow-[0_-6px_16px_rgba(238,242,255,0.85)] ring-1 ring-indigo-100/80 backdrop-blur-[2px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-indigo-800">
              Monitor · {agentModeLabel(agentMode)}
              {aiBusy ? ' · pensando…' : ''}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={agentMode === 'human'}
                onClick={onTakeOver}
                className="rounded-lg bg-[#5b6cff] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
              >
                Tomar control
              </button>
              <button
                type="button"
                disabled={agentMode === 'paused'}
                onClick={onPauseAi}
                className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-40"
              >
                Pausar IA
              </button>
              <button
                type="button"
                disabled={agentMode === 'ai_active'}
                onClick={onResumeAi}
                className="rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-900 disabled:opacity-40"
              >
                Reanudar IA
              </button>
            </div>
          </div>
          <p className="mt-1.5 leading-relaxed text-indigo-900/80">
            {agentMode === 'ai_active'
              ? 'IA responde de punta a punta (tools + reply). Monitoreá el log en el rail.'
              : agentMode === 'paused'
                ? 'IA pausada — no auto-responde. Podés escribir vos o reanudar.'
                : 'Control humano — la IA no responde hasta que reanudés.'}
          </p>
        </div>

        <div ref={messagesEndRef} />
      </div>

      {closedWindow || showTemplateCta ? (
        <div className="shrink-0 border-t border-slate-100 px-4 py-4 sm:px-5">
          <div className="rounded-2xl bg-red-50 px-4 py-4 text-center">
            <p className="text-sm font-semibold text-red-800">Ventana de 24h cerrada</p>
            <p className="mt-1 text-xs text-red-700">
              Solo plantilla aprobada hasta que escriba de nuevo.
            </p>
            <button
              type="button"
              className="mt-3 rounded-xl bg-[#5b6cff] px-4 py-2.5 text-sm font-medium text-white"
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
                  <a href="/config/social" className="font-semibold underline underline-offset-2">
                    Reconectar
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="shrink-0 border-t border-slate-100 px-4 py-3 sm:px-5">
          {!composerEnabled ? (
            <p className="mb-2 text-[11px] text-slate-500">
              Composer humano desactivado mientras la IA está activa — usá Tomar control o Pausar.
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
                  <a href="/config/social" className="font-semibold underline underline-offset-2">
                    Reconectar
                  </a>
                </>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={onSend} className="flex gap-2">
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
                    ? 'Mensaje… Enter envía'
                    : 'Escribí un mensaje… Enter envía · Shift+Enter nueva línea'
                  : 'Tomá control o pausá la IA para escribir'
              }
              disabled={sending || !composerEnabled}
              className="min-w-0 flex-1 resize-none rounded-xl border-0 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-900 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5b6cff]/35 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !messageInput.trim() || !composerEnabled}
              className="shrink-0 rounded-xl bg-[#5b6cff] px-4 py-3 text-[13px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? '…' : 'Enviar'}
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
