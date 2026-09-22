'use client'

import React, { useMemo, useState } from 'react'
import { AgentInternalTests } from '@/app/config/agentes/AgentInternalTests'
import { selectWhatsappTestChannel, type TestChannelOption } from '@/lib/soft-ai/test-channel'

type HistoryItem = { direction: 'inbound' | 'outbound'; content: string; sentAt: string }

type TurnResult = {
  text: string
  tokens?: { input: number; output: number; cached: number }
  latencyMs?: number
  wouldSend?: boolean
  blockedBy?: string[]
  highlightedAmounts?: number[]
  intent?: string
  shortcutKey?: string | null
  decisionTrace?: unknown
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
}: {
  agentId: string
  canEdit: boolean
  channels: TestChannelOption[]
  channelsLoaded: boolean
  socialAccountId: string | null
  onSelectChannel: (socialAccountId: string) => void
}) {
  const [sessionId] = useState(() => crypto.randomUUID())
  const [text, setText] = useState('precio con envío?')
  const [messageType, setMessageType] = useState<'text' | 'image' | 'audio' | 'document' | 'video'>('text')
  const [windowOpen, setWindowOpen] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [last, setLast] = useState<TurnResult | null>(null)
  const [replay, setReplay] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selection = useMemo(
    () => selectWhatsappTestChannel(channels, socialAccountId),
    [channels, socialAccountId],
  )
  const channelReady = Boolean(socialAccountId)

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
          history,
          windowOpen,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en Probar')
      const outbound = typeof data.text === 'string' ? data.text : ''
      const now = new Date().toISOString()
      setHistory((prev) =>
        [
          ...prev,
          { direction: 'inbound' as const, content: inbound, sentAt: now },
          ...(outbound ? [{ direction: 'outbound' as const, content: outbound, sentAt: now }] : []),
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
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/test/replay`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en replay')
      setReplay(data)
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
          history.map((item, index) => {
            const mine = item.direction === 'inbound'
            return (
              <div key={`${item.sentAt}-${index}`} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm !text-slate-900 ${
                    mine ? 'bg-[#d9fdd3]' : 'bg-white ring-1 ring-slate-200'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{item.content}</p>
                  <p className="mt-1 text-[10px] text-slate-600">{clock(item.sentAt)}</p>
                </div>
              </div>
            )
          })
        )}
      </div>
      {channelsLoaded && selection.mode === 'empty' ? (
        <p className="mt-3 text-sm text-slate-800">Conectá un canal en Canales</p>
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
        last={last}
        replay={replay}
        onMessageType={setMessageType}
        onWindowOpen={setWindowOpen}
        onReplay={() => void replayAll()}
      />
    </div>
  )
}
