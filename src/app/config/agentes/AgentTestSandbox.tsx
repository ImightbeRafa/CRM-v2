'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AgentInternalTests } from '@/app/config/agentes/AgentInternalTests'
import { formatUnlockConfirm, formatUnlockSuccessLine } from '@/lib/soft-ai/agent-config'
import { selectWhatsappTestChannel, type TestChannelOption } from '@/lib/soft-ai/test-channel'

export type WaBubble = {
  kind: 'text'
  from: 'customer' | 'agent'
  text: string
  at: string
  label?: string
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
}

function BubbleView({ bubble }: { bubble: WaBubble }) {
  switch (bubble.kind) {
    case 'text': {
      const customer = bubble.from === 'customer'
      return (
        <div className={`flex ${customer ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm !text-slate-900 ${
              customer ? 'bg-[#d9fdd3]' : 'bg-white ring-1 ring-slate-200'
            }`}
          >
            {bubble.label ? <p className="text-[10px] font-medium text-slate-700">{bubble.label}</p> : null}
            <p className="whitespace-pre-wrap">{bubble.text}</p>
            <p className="mt-1 text-[10px] text-slate-600">{clock(bubble.at)}</p>
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

function replayIsGreen(
  replay: Record<string, unknown> | null,
  socialAccountId: string | null,
  agentId: string,
): boolean {
  if (!replay || !socialAccountId) return false
  if (replay.socialAccountId !== socialAccountId) return false
  if (replay.boundAgentId !== agentId) return false
  const passRate = typeof replay.passRate === 'number' ? replay.passRate : Number.NaN
  const violations = typeof replay.policyViolations === 'number' ? replay.policyViolations : Number.NaN
  const examined = typeof replay.examined === 'number' ? replay.examined : Number.NaN
  return passRate === 1 && violations === 0 && replay.capped !== true && examined > 0
}

export function AgentTestSandbox({
  agentId,
  agentName,
  canEdit,
  channels,
  channelsLoaded,
  socialAccountId,
  onSelectChannel,
  onUnlocked,
}: {
  agentId: string
  agentName: string
  canEdit: boolean
  channels: TestChannelOption[]
  channelsLoaded: boolean
  socialAccountId: string | null
  onSelectChannel: (socialAccountId: string) => void
  onUnlocked?: () => void
}) {
  const [sessionId] = useState(() => crypto.randomUUID())
  const [text, setText] = useState('precio con envío?')
  const [messageType, setMessageType] = useState<'text' | 'image' | 'audio' | 'document' | 'video'>('text')
  const [windowOpen, setWindowOpen] = useState(true)
  const [customerName, setCustomerName] = useState('')
  const [conversationAiMode, setConversationAiMode] = useState<'ai_active' | 'human' | 'paused'>('ai_active')
  const [history, setHistory] = useState<WaBubble[]>([])
  const [last, setLast] = useState<TurnResult | null>(null)
  const [replay, setReplay] = useState<Record<string, unknown> | null>(null)
  const [confirmingUnlock, setConfirmingUnlock] = useState(false)
  const [unlockLine, setUnlockLine] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setReplay(null)
    setConfirmingUnlock(false)
    setUnlockLine(null)
  }, [agentId, socialAccountId])

  const selection = useMemo(
    () => selectWhatsappTestChannel(channels, socialAccountId),
    [channels, socialAccountId],
  )
  const channelReady = Boolean(socialAccountId)
  const channelLabel =
    channels.find((row) => row.id === socialAccountId)?.label || 'este canal'
  const canApprove = replayIsGreen(replay, socialAccountId, agentId)

  async function sendTurn() {
    if (!canEdit || !socialAccountId || !text.trim()) return
    const inbound = text.trim()
    setBusy(true)
    setError(null)
    setText('')
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboundText: inbound,
          socialAccountId,
          testSessionId: sessionId,
          messageType,
          history: history.map((bubble) => ({
            direction: bubble.from === 'customer' ? 'inbound' : 'outbound',
            content: bubble.text,
            sentAt: bubble.at,
          })),
          windowOpen,
          customerName: customerName.trim() || undefined,
          conversationAiMode,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en Probar')
      const outbound = typeof data.text === 'string' ? data.text : ''
      const blockedBefore =
        Array.isArray(data.blockedBy) && data.blockedBy.includes('not_bound_to_channel')
      const now = new Date().toISOString()
      setHistory((prev) =>
        [
          ...prev,
          { kind: 'text' as const, from: 'customer' as const, text: inbound, at: now },
          ...(outbound && !blockedBefore
            ? [{ kind: 'text' as const, from: 'agent' as const, text: outbound, at: now }]
            : []),
        ].slice(-40),
      )
      setLast(data)
    } catch (e) {
      setText(inbound)
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function replayAll() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    setConfirmingUnlock(false)
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/test/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(socialAccountId ? { socialAccountId } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en replay')
      setReplay(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmUnlock() {
    if (!canEdit || !socialAccountId || !replayIsGreen(replay, socialAccountId, agentId)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/test/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socialAccountId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo aprobar')
      const record = data.record as {
        fixtureSetHash?: string
        passRate?: number
        passedAt?: string
      } | null
      const passedAt = typeof record?.passedAt === 'string' ? new Date(record.passedAt) : null
      const passedAtLabel =
        passedAt && !Number.isNaN(passedAt.getTime())
          ? passedAt.toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' })
          : ''
      setUnlockLine(
        formatUnlockSuccessLine({
          fixtureSetHash: typeof record?.fixtureSetHash === 'string' ? record.fixtureSetHash : '',
          passRate: typeof record?.passRate === 'number' ? record.passRate : 0,
          approvedByName: typeof data.approvedByName === 'string' ? data.approvedByName : '',
          passedAtLabel,
        }),
      )
      setConfirmingUnlock(false)
      onUnlocked?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Probar conversación</h2>
      <p className={`mt-0.5 ${HINT}`}>WhatsApp · sandbox. No escribe a Meta ni a un chat real.</p>
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
      <div className="mt-3 min-h-48 space-y-2 rounded-lg bg-[#efeae2] p-3">
        {history.length === 0 ? (
          <p className="text-sm text-slate-700">Escribí como cliente para ver la respuesta.</p>
        ) : (
          history.map((bubble, index) => (
            <BubbleView key={`${bubble.at}-${index}`} bubble={bubble} />
          ))
        )}
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
            void sendTurn()
          }}
        >
          <textarea
            className={FIELD}
            rows={2}
            value={text}
            disabled={!canEdit || busy || !channelReady}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendTurn()
              }
            }}
          />
          <button
            type="submit"
            disabled={!canEdit || busy || !channelReady || !text.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:bg-indigo-400"
          >
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      <AgentInternalTests
        canEdit={canEdit}
        busy={busy}
        messageType={messageType}
        windowOpen={windowOpen}
        customerName={customerName}
        conversationAiMode={conversationAiMode}
        last={last}
        replay={replay}
        canApprove={canApprove}
        confirmingUnlock={confirmingUnlock}
        unlockLine={unlockLine}
        confirmCopy={formatUnlockConfirm(channelLabel, agentName)}
        onMessageType={setMessageType}
        onWindowOpen={setWindowOpen}
        onCustomerName={setCustomerName}
        onConversationAiMode={setConversationAiMode}
        onReplay={() => void replayAll()}
        onAskUnlock={() => setConfirmingUnlock(true)}
        onCancelUnlock={() => setConfirmingUnlock(false)}
        onConfirmUnlock={() => void confirmUnlock()}
      />
    </div>
  )
}
