'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AgentInternalTests } from '@/app/config/agentes/AgentInternalTests'
import { AgentActivationCard } from '@/app/config/agentes/AgentActivationCard'
import { selectWhatsappTestChannel, type TestChannelOption } from '@/lib/soft-ai/test-channel'
import { ProbarScenarios } from '@/app/config/agentes/ProbarScenarios'

export type WaBubble = {
  kind: 'text'
  from: 'customer' | 'agent' | 'system'
  text: string
  at: string
  label?: string
  /** Agent bubbles: what it used / why (test chat only). */
  why?: string[]
  latencyMs?: number
  /** Agent images (saved reply it used), shown before the text like WhatsApp. */
  images?: Array<{ assetId: string; url: string; name: string }>
}

type TurnResult = {
  text: string
  tokens?: { input: number; output: number; cached: number }
  latencyMs?: number
  wouldSend?: boolean
  outcome?: 'send' | 'suggest' | 'skip'
  needsHuman?: boolean
  fallbackUsed?: boolean
  escalate?: boolean
  blockedBy?: string[]
  highlightedAmounts?: number[]
  intent?: string
  shortcutKey?: string | null
  decisionTrace?: unknown
  why?: string[]
}

function BubbleView({ bubble }: { bubble: WaBubble }) {
  switch (bubble.kind) {
    case 'text': {
      const customer = bubble.from === 'customer'
      if (bubble.from === 'system') {
        return (
          <div className="flex justify-center">
            <div className="max-w-[90%] rounded-lg bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-900 ring-1 ring-amber-100">
              <p className="font-medium">Sin respuesta para el cliente</p>
              {(bubble.why ?? []).map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          </div>
        )
      }
      return (
        <div className={`flex ${customer ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm !text-slate-900 ${
              customer ? 'bg-au-tint-d9fdd3' : 'bg-white ring-1 ring-slate-200'
            }`}
          >
            {bubble.label ? <p className="text-[10px] font-medium text-slate-700">{bubble.label}</p> : null}
            {bubble.images?.length ? (
              <div className="mb-1.5 space-y-1.5">
                {bubble.images.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element -- private, same-origin agent image
                  <img key={img.assetId} src={img.url} alt={img.name} loading="lazy" className="max-h-72 w-full rounded-lg object-contain bg-slate-50" />
                ))}
              </div>
            ) : null}
            {bubble.text ? <p className="whitespace-pre-wrap">{bubble.text}</p> : null}
            <p className="mt-1 text-[10px] text-slate-600">
              {clock(bubble.at)}
              {typeof bubble.latencyMs === 'number' && bubble.latencyMs > 0 ? ` · ${(bubble.latencyMs / 1000).toFixed(1)} s` : ''}
            </p>
            {bubble.why?.length ? (
              <ul className="mt-1 space-y-0.5 border-t border-slate-100 pt-1">
                {bubble.why.map((w) => (
                  <li key={w} className="text-[10.5px] text-slate-500">
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )
    }
    default: {
      const _exhaustive: never = bubble.kind
      return _exhaustive
    }
  }
}

const FIELD =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 disabled:bg-slate-100 disabled:!text-slate-600'
const HINT = 'text-[11px] text-slate-600'

function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })
}

export function AgentTestSandbox({
  agentId,
  canEdit,
  channels,
  channelsLoaded,
  socialAccountId,
  onSelectChannel,
  onUnlocked,
  agentModel,
  operationMode,
  configuredModels,
}: {
  agentId: string
  /** Kept for callers; the activation card names the channel instead. */
  agentName?: string
  canEdit: boolean
  channels: TestChannelOption[]
  channelsLoaded: boolean
  socialAccountId: string | null
  onSelectChannel: (socialAccountId: string) => void
  onUnlocked?: () => void
  agentModel?: string
  configuredModels?: string[]
  operationMode?: string
}) {
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const [text, setText] = useState('')
  const [messageType, setMessageType] = useState<'text' | 'image' | 'audio' | 'document' | 'video'>('text')
  const [windowOpen, setWindowOpen] = useState(true)
  const [customerName, setCustomerName] = useState('')
  const [conversationAiMode, setConversationAiMode] = useState<'ai_active' | 'human' | 'paused'>('ai_active')
  const [history, setHistory] = useState<WaBubble[]>([])
  const [last, setLast] = useState<TurnResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selection = useMemo(
    () => selectWhatsappTestChannel(channels, socialAccountId),
    [channels, socialAccountId],
  )
  const channelReady = Boolean(socialAccountId)
  const channelLabel =
    channels.find((row) => row.id === socialAccountId)?.label || 'este canal'

  // The chat never freezes: the client's message shows at once, the agent "types", and further messages queue up
  // in order (each one sent with the history as it stands when its turn comes — same as a real chat).
  const historyRef = useRef<WaBubble[]>([])
  historyRef.current = history
  const queueRef = useRef<string[]>([])
  const runningRef = useRef(false)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, busy])

  function sendTurn() {
    if (!canEdit || !socialAccountId || !text.trim()) return
    const inbound = text.trim()
    setText('')
    setError(null)
    setHistory((prev) => [...prev, { kind: 'text' as const, from: 'customer' as const, text: inbound, at: new Date().toISOString() }].slice(-40))
    queueRef.current.push(inbound)
    void drainQueue()
  }

  async function drainQueue() {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    try {
      while (queueRef.current.length) {
        const inbound = queueRef.current.shift() as string
        await runTurn(inbound, sessionRef.current)
      }
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }

  async function runTurn(inbound: string, forSession: string) {
    try {
      // History = everything before this message (the message itself is already shown as a bubble).
      const all = historyRef.current.filter((bubble) => bubble.from !== 'system')
      const idx = all.map((b) => b.from === 'customer' && b.text === inbound).lastIndexOf(true)
      const before = idx >= 0 ? all.slice(0, idx) : all
      const res = await fetch(`/api/chat/agents/${agentId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboundText: inbound,
          socialAccountId,
          testSessionId: forSession,
          messageType,
          history: before.map((bubble) => ({
            direction: bubble.from === 'customer' ? 'inbound' : 'outbound',
            content: bubble.text,
            sentAt: bubble.at,
          })),
          windowOpen,
          customerName: customerName.trim() || undefined,
          conversationAiMode,
          sentImageIds: before.flatMap((bubble) => (bubble.images ?? []).map((img) => img.assetId)).slice(-30),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en Probar')
      // "Nueva conversación" pressed meanwhile: drop the late answer.
      if (forSession !== sessionRef.current) return
      const outbound = typeof data.text === 'string' ? data.text : ''
      const images = Array.isArray(data.images)
        ? (data.images as Array<{ assetId?: unknown; url?: unknown; name?: unknown }>)
            .filter((img) => typeof img.assetId === 'string' && typeof img.url === 'string' && img.url.startsWith(`/api/chat/agents/${agentId}/assets/`))
            .map((img) => ({ assetId: String(img.assetId), url: String(img.url), name: typeof img.name === 'string' ? img.name : 'imagen' }))
        : []
      const blockedBefore =
        Array.isArray(data.blockedBy) && data.blockedBy.includes('not_bound_to_channel')
      const now = new Date().toISOString()
      setHistory((prev) =>
        [
          ...prev,
          ...(outbound && !blockedBefore
            ? [
                {
                  kind: 'text' as const,
                  from: 'agent' as const,
                  text: outbound,
                  at: now,
                  images: images.length ? images : undefined,
                  why: Array.isArray(data.why) ? (data.why as string[]) : undefined,
                  latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
                },
              ]
            : [
                // No reply would reach a real client: say why instead of showing nothing.
                {
                  kind: 'text' as const,
                  from: 'system' as const,
                  text: '',
                  at: now,
                  why: Array.isArray(data.why) && data.why.length ? (data.why as string[]) : ['el agente no respondió'],
                },
              ]),
        ].slice(-40),
      )
      setLast(data)
    } catch (e) {
      if (forSession !== sessionRef.current) return
      setError(e instanceof Error ? e.message : 'Error')
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <AgentActivationCard
        agentId={agentId}
        socialAccountId={socialAccountId}
        channelLabel={channelLabel}
        canEdit={canEdit}
        onChanged={onUnlocked}
      />
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Probar como cliente</h2>
          <p className={`mt-0.5 ${HINT}`}>Escribí como un cliente: recibís la misma respuesta que recibiría en WhatsApp. No escribe a nadie real.</p>
        </div>
        <button
          type="button"
          disabled={history.length === 0}
          onClick={() => {
            queueRef.current = []
            setSessionId(crypto.randomUUID())
            setHistory([])
            setLast(null)
            setError(null)
          }}
          className="shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40"
        >
          Nueva conversación
        </button>
      </div>
      {selection.mode === 'pick' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selection.options.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelectChannel(row.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                socialAccountId === row.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white !text-slate-900 ring-1 ring-slate-200'
              }`}
            >
              {row.label}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={scrollRef} className="mt-3 max-h-[60vh] min-h-48 space-y-2 overflow-y-auto rounded-lg bg-au-tint-efeae2 p-3">
        {history.length === 0 ? (
          <p className="text-sm text-slate-700">Escribí como cliente para ver la respuesta.</p>
        ) : (
          history.map((bubble, index) => (
            <BubbleView key={`${bubble.at}-${index}`} bubble={bubble} />
          ))
        )}
        {busy ? (
          <div className="flex justify-start" aria-live="polite">
            <div className="rounded-2xl bg-white px-3 py-2 text-[12px] text-slate-500 ring-1 ring-slate-200">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
              </span>
              <span className="ml-2">escribiendo…</span>
            </div>
          </div>
        ) : null}
      </div>
      {channelsLoaded && selection.mode === 'empty' ? (
        <p className="mt-3 text-sm text-slate-800">
          Este agente no atiende ningún canal de WhatsApp. Activalo en Canales.
        </p>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            sendTurn()
          }}
        >
          <textarea
            className={FIELD}
            rows={2}
            value={text}
            disabled={!canEdit || !channelReady}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendTurn()
              }
            }}
          />
          <button
            type="submit"
            disabled={!canEdit || !channelReady || !text.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:bg-indigo-400"
          >
            Enviar
          </button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-medium text-slate-500">Opciones de prueba avanzadas</summary>
      <AgentInternalTests
        canEdit={canEdit}
        busy={busy}
        messageType={messageType}
        windowOpen={windowOpen}
        customerName={customerName}
        conversationAiMode={conversationAiMode}
        last={last}
        onMessageType={setMessageType}
        onWindowOpen={setWindowOpen}
        onCustomerName={setCustomerName}
        onConversationAiMode={setConversationAiMode}
      />
      <ProbarScenarios
        agentId={agentId}
        socialAccountId={socialAccountId}
        canEdit={canEdit}
        agentModel={agentModel}
        operationMode={operationMode}
        configuredModels={configuredModels}
        conversation={history.filter((b) => b.from !== 'system').map((b) => ({ from: b.from as 'customer' | 'agent', text: b.text }))}
      />
      </details>
    </div>
  )
}
