'use client'

import { useState, type FormEvent, type Ref } from 'react'
import {
  isWhatsAppWindowOpen,
  platformShort,
  type ConversationStatus,
  type SoftConversation,
  type SoftTag,
} from '@/lib/chat-soft-copilot'
import { agentModeLabel, isSoftHumanComposerEnabled, type SoftAiAgentMode } from '@/lib/soft-ai'

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
  failedOutboundId?: string | null
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

export function SoftThreadPane({
  conversation,
  messageInput,
  onMessageInput,
  onSend,
  sending,
  sendError,
  onClearError,
  onRetry,
  failedOutboundId,
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
  const channelName = conversation.platform === 'whatsapp' ? 'WhatsApp' : 'Instagram'
  const metaLine = [
    channelName,
    conversation.accountLabel.replace(/^(WA|IG)\s·\s/, ''),
    statusLabel(conversation.status),
    windowLabel,
  ]
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
              className={`mt-0.5 truncate text-[11px] ${
                closedWindow ? 'font-medium text-red-600' : 'text-slate-500'
              }`}
            >
              {compact && closedWindow
                ? `${platformShort(conversation.platform)} · ventana 24h CERRADA`
                : metaLine}
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

        {conversation.messages.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400">Sin mensajes en este chat</p>
            <p className="mt-1 text-[11px] text-slate-400">
              La IA responde cuando llegue el primer inbound.
            </p>
          </div>
        ) : (
          conversation.messages.map((msg) => {
            const outbound = msg.direction === 'outbound'
            const failed = failedOutboundId === msg.id
            const softAi = Boolean(msg.id?.startsWith('demo-ai-'))
            return (
              <div
                key={msg.id}
                className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
              >
                <div className="max-w-[85%] sm:max-w-md">
                  <div
                    className={`rounded-[14px] px-3.5 py-2.5 text-[13px] ${
                      outbound
                        ? softAi
                          ? 'bg-indigo-100 text-indigo-950'
                          : 'bg-blue-100 text-blue-950'
                        : 'bg-slate-100 text-slate-900'
                    }`}
                  >
                    {msg.content}
                  </div>
                  {outbound ? (
                    <p
                      className={`mt-1 text-right text-[10px] ${
                        failed ? 'font-medium text-red-600' : 'text-slate-500'
                      }`}
                    >
                      {failed ? (
                        <>
                          Falló ✕{' '}
                          {onRetry ? (
                            <button
                              type="button"
                              onClick={onRetry}
                              className="underline underline-offset-2"
                            >
                              Reintentar
                            </button>
                          ) : null}
                        </>
                      ) : softAi ? (
                        'IA ✓'
                      ) : (
                        'Enviado ✓'
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })
        )}

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
            </div>
          ) : null}

          <form onSubmit={onSend} className="flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => {
                onMessageInput(e.target.value)
                if (sendError) onClearError()
              }}
              placeholder={
                composerEnabled
                  ? compact
                    ? 'Mensaje… Enter envía'
                    : 'Escribí un mensaje…  Enter envía'
                  : 'Tomá control o pausá la IA para escribir'
              }
              disabled={sending || !composerEnabled}
              className="min-w-0 flex-1 rounded-xl border-0 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-900 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5b6cff]/35 disabled:opacity-60"
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
              Enter envía · ⌘K busca · Esc cierra · ↑↓ lista
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
