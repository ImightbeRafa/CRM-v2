'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_AGENT_MODEL_ALLOWLIST, modelLabel } from '@/lib/soft-ai/agent-types'
import {
  BUILT_IN_SCENARIOS,
  GROUP_LABELS,
  evaluateStep,
  summarizeRun,
  type Scenario,
  type ScenarioGroup,
  type ScenarioStep,
  type StepEvaluation,
} from '@/lib/soft-ai/probar-scenarios'

type StepOutcome = {
  customer: string[]
  reply: string
  outcome?: string
  handedOff: boolean
  evaluation: StepEvaluation
  tokens: number
}
type RunState = { status: 'idle' | 'running' | 'done'; steps: StepOutcome[]; pass: boolean; notRun: boolean; scored: boolean }
type SavedTest = { id: string; title: string; steps: ScenarioStep[] }
type Bubble = { from: 'customer' | 'agent'; text: string }
type Runnable = { id: string; title: string; description?: string; steps: ScenarioStep[]; scored?: boolean }

const MODE_LABEL: Record<string, string> = {
  ai_suggest: 'Sugerir (una persona revisa)',
  ai_full: 'Responder solo',
  human_only: 'Solo humanos',
}

const card = 'mt-4 rounded-lg border border-slate-200 bg-white p-3'
const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-slate-300 bg-white !text-slate-900 disabled:opacity-50'
const btnPrimary = 'rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-indigo-400'
const MAX_SAVE_MESSAGES = 12


type PlayResult = {
  text?: string
  outcome?: 'send' | 'suggest' | 'skip'
  escalate?: boolean
  needsHuman?: boolean
  fallbackUsed?: boolean
  blockedBy?: string[]
  tokens?: { input: number; output: number; cached: number }
  latencyMs?: number
  model?: string
}

async function playStep(args: {
  agentId: string
  socialAccountId: string
  sessionId: string
  step: ScenarioStep
  history: Array<{ direction: 'inbound' | 'outbound'; content: string; sentAt: string }>
  modelOverride?: string
}): Promise<PlayResult> {
  const now = new Date().toISOString()
  const earlier = (args.step.burst ?? []).map((text) => ({ direction: 'inbound' as const, content: text, sentAt: now }))
  const send = () => fetch(`/api/chat/agents/${encodeURIComponent(args.agentId)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inboundText: args.step.text,
      socialAccountId: args.socialAccountId,
      testSessionId: args.sessionId,
      messageType: args.step.messageType ?? 'text',
      history: [...args.history, ...earlier].slice(-40),
      windowOpen: args.step.windowOpen !== false,
      customerName: args.step.customerName,
      conversationAiMode: args.step.aiMode ?? 'ai_active',
      modelOverride: args.modelOverride,
    }),
  })
  let res = await send()
  // "Probar todo" can go past the 30-per-minute limit: wait as the server asks (max 3 times) instead of failing.
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt += 1) {
    const waitS = Math.min(60, Math.max(2, Number(res.headers.get('Retry-After')) || 10))
    await new Promise((resolve) => setTimeout(resolve, waitS * 1_000))
    res = await send()
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en Probar')
  return data as PlayResult
}

function ScenarioRow({
  s,
  r,
  isOpen,
  custom,
  canRun,
  canEdit,
  onRun,
  onToggle,
  onDelete,
}: {
  s: Runnable
  r: RunState | undefined
  isOpen: boolean
  custom?: boolean
  canRun: boolean
  canEdit: boolean
  onRun: () => void
  onToggle: () => void
  onDelete?: () => void
}) {
  const icon = !r || r.status === 'idle' ? '○' : r.status === 'running' ? '…' : r.notRun ? '⚠' : r.pass ? '✓' : '✗'
  const tone = !r ? 'text-slate-400' : r.status === 'running' ? 'text-slate-500' : r.notRun ? 'text-amber-700' : r.pass ? 'text-emerald-700' : 'text-red-700'
  return (
    <li className="rounded-lg border border-slate-100 p-2" data-testid="probar-scenario">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 w-4 text-center text-sm font-semibold ${tone}`} aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-slate-900">
            {s.title}
            {s.scored === false ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-600">regla del sistema</span> : null}
          </p>
          {s.description ? <p className="text-[11.5px] text-slate-500">{s.description}</p> : null}
        </div>
        <button type="button" className={btn} disabled={!canRun || r?.status === 'running'} onClick={onRun}>
          Ejecutar
        </button>
        {r?.status === 'done' ? (
          <button type="button" className={btn} onClick={onToggle}>
            {isOpen ? 'Ocultar' : 'Ver'}
          </button>
        ) : null}
        {custom && onDelete ? (
          <button type="button" className="text-[11px] text-red-700 hover:underline disabled:opacity-40" disabled={!canEdit} onClick={onDelete}>
            Borrar
          </button>
        ) : null}
      </div>
      {r?.status === 'done' && isOpen ? (
        <div className="mt-2 space-y-1.5 rounded-md bg-slate-50 p-2 text-[12px]">
          {r.steps.map((st, i) => (
            <div key={i}>
              {st.customer.map((c, j) => (
                <p key={j} className="text-slate-700">
                  <span className="font-semibold">Cliente:</span> {c}
                </p>
              ))}
              <p className="text-slate-900">
                <span className="font-semibold">Agente:</span> {st.reply || <em className="text-slate-500">(no respondió)</em>}
                <span className="ml-1 text-slate-500">
                  {st.outcome === 'send' ? '· enviaría' : st.outcome === 'suggest' ? '· sugeriría' : st.outcome === 'skip' ? '· omitiría' : ''}
                  {st.handedOff ? ' · pasa a una persona' : ''}
                </span>
              </p>
              {st.evaluation.failures.length ? (
                <ul className={`list-disc pl-5 ${st.evaluation.notRun ? 'text-amber-800' : 'text-red-700'}`}>
                  {st.evaluation.failures.map((f, k) => (
                    <li key={k}>{f}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-emerald-700">Cumplió las reglas de esta prueba.</p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </li>
  )
}

/** The playground extras: ready-made scenarios, saved tests, model comparison. Nothing here sends to a customer. */
export function ProbarScenarios({
  agentId,
  socialAccountId,
  canEdit,
  agentModel,
  operationMode,
  configuredModels,
  conversation,
}: {
  agentId: string
  socialAccountId: string | null
  canEdit: boolean
  agentModel?: string
  operationMode?: string
  configuredModels?: string[]
  conversation: Bubble[]
}) {
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Record<string, RunState>>({})
  const [saved, setSaved] = useState<SavedTest[]>([])
  const [savedReady, setSavedReady] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [singleBusy, setSingleBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const stopRef = useRef(false)

  const [saveTitle, setSaveTitle] = useState('')
  const [saveRule, setSaveRule] = useState<'none' | 'handoff' | 'nohandoff'>('none')
  const [saveForbid, setSaveForbid] = useState('')

  const [cmpText, setCmpText] = useState('¿en cuánto sale el envío a Heredia?')
  const [cmpModel, setCmpModel] = useState<string>('')
  const [cmpBusy, setCmpBusy] = useState(false)
  const [cmpOut, setCmpOut] = useState<null | { a: PlayResult; b: PlayResult }>(null)
  const [cmpError, setCmpError] = useState<string | null>(null)

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/test-cases`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { available?: boolean; cases?: SavedTest[] }
      setSavedReady(json.available !== false)
      setSaved(json.cases ?? [])
    } catch {
      /* optional */
    }
  }, [agentId])

  useEffect(() => {
    void loadSaved()
  }, [loadSaved])

  const ready = Boolean(socialAccountId) && canEdit
  const customerMessages = conversation.filter((b) => b.from === 'customer').map((b) => b.text)

  async function runScenario(s: Runnable): Promise<RunState> {
    if (!socialAccountId) throw new Error('Elegí un canal.')
    const scored = s.scored !== false
    if (s.steps.length === 0) {
      return {
        status: 'done',
        scored,
        notRun: true,
        pass: false,
        steps: [
          {
            customer: [],
            reply: '',
            handedOff: false,
            tokens: 0,
            evaluation: { pass: false, notRun: true, failures: ['La prueba guardada es inválida: guardala de nuevo.'] },
          },
        ],
      }
    }
    const sessionId = crypto.randomUUID()
    const history: Array<{ direction: 'inbound' | 'outbound'; content: string; sentAt: string }> = []
    const outcomes: StepOutcome[] = []
    for (const step of s.steps) {
      const r = await playStep({ agentId, socialAccountId, sessionId, step, history })
      const reply = (r.text || '').trim()
      const notBound = r.blockedBy?.includes('not_bound_to_channel')
      const evaluation: StepEvaluation = notBound
        ? { pass: false, notRun: true, failures: ['Este agente no atiende ese canal: activalo en Canales.'] }
        : evaluateStep(
            {
              text: reply,
              outcome: r.outcome,
              escalate: r.escalate,
              needsHuman: r.needsHuman,
              fallbackUsed: r.fallbackUsed,
              blockedBy: r.blockedBy,
            },
            step.expect,
          )
      outcomes.push({
        customer: [...(step.burst ?? []), step.text],
        reply,
        outcome: r.outcome,
        handedOff: Boolean(r.escalate || r.needsHuman),
        evaluation,
        tokens: (r.tokens?.input ?? 0) + (r.tokens?.output ?? 0),
      })
      const at = new Date().toISOString()
      for (const text of step.burst ?? []) history.push({ direction: 'inbound', content: text, sentAt: at })
      history.push({ direction: 'inbound', content: step.text, sentAt: at })
      // The reply stays in the history whatever the gates decided (the real conversation would show it as a draft).
      if (reply && !notBound) history.push({ direction: 'outbound', content: reply, sentAt: at })
      if (evaluation.notRun) break
    }
    const notRun = outcomes.some((o) => o.evaluation.notRun)
    return { status: 'done', steps: outcomes, pass: outcomes.every((o) => o.evaluation.pass), notRun, scored }
  }

  async function runOne(s: Runnable) {
    if (running || singleBusy) return
    setSingleBusy(true)
    setMessage(null)
    setResults((prev) => ({ ...prev, [s.id]: { status: 'running', steps: [], pass: false, notRun: false, scored: s.scored !== false } }))
    try {
      const state = await runScenario(s)
      setResults((prev) => ({ ...prev, [s.id]: state }))
      setOpen(s.id)
    } catch (e) {
      setResults((prev) => ({ ...prev, [s.id]: { status: 'idle', steps: [], pass: false, notRun: false, scored: true } }))
      setMessage(e instanceof Error ? e.message : 'Error')
    } finally {
      setSingleBusy(false)
    }
  }

  async function runAll() {
    const all: Runnable[] = [
      ...BUILT_IN_SCENARIOS.map((s) => ({ id: s.id, title: s.title, steps: s.steps, scored: s.scored })),
      ...saved.map((c) => ({ id: `saved:${c.id}`, title: c.title, steps: c.steps })),
    ]
    const stepCount = all.reduce((n, s) => n + s.steps.length, 0)
    if (
      !window.confirm(
        `Se van a ejecutar ${all.length} pruebas (${stepCount} mensajes). ` +
          'Cuentan contra el tope diario de pruebas, que también usa la aprobación del envío real. ¿Seguir?',
      )
    ) {
      return
    }
    stopRef.current = false
    setRunning(true)
    setMessage(null)
    setResults({})
    const collected: Array<{ id: string; title: string; state: RunState }> = []
    let incomplete: string | null = null
    try {
      for (const s of all) {
        if (stopRef.current) {
          incomplete = 'Detenido: el resultado no se guardó porque la corrida quedó incompleta.'
          break
        }
        setResults((prev) => ({ ...prev, [s.id]: { status: 'running', steps: [], pass: false, notRun: false, scored: s.scored !== false } }))
        const state = await runScenario(s)
        collected.push({ id: s.id, title: s.title, state })
        setResults((prev) => ({ ...prev, [s.id]: state }))
        if (state.notRun) {
          incomplete = state.steps.flatMap((x) => x.evaluation.failures)[0] ?? 'Una prueba no se pudo ejecutar: la corrida quedó incompleta.'
          break
        }
      }
    } catch (e) {
      incomplete = `${e instanceof Error ? e.message : 'Error'} (la corrida quedó incompleta y no se guardó).`
    } finally {
      setRunning(false)
    }
    const scoredRuns = collected.filter((c) => c.state.scored)
    const sum = summarizeRun(scoredRuns.map((c) => ({ pass: c.state.pass, notRun: c.state.notRun })))
    if (incomplete) {
      setMessage(incomplete)
      return
    }
    const failures = scoredRuns
      .filter((c) => !c.state.pass)
      .map((c) => ({ id: c.id, title: c.title, reason: c.state.steps.flatMap((s) => s.evaluation.failures)[0] ?? 'No pasó' }))
    try {
      await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/scenario-runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sum, failures, customCount: saved.length }),
      })
    } catch {
      /* the result is still on screen */
    }
    setMessage(`${sum.passed} de ${sum.examined} escenarios pasaron.`)
  }

  async function saveCurrent() {
    if (savingRef.current) return // double click must not save the test twice
    if (!canEdit || customerMessages.length === 0 || customerMessages.length > MAX_SAVE_MESSAGES || !saveTitle.trim()) return
    savingRef.current = true
    setSaving(true)
    const steps: ScenarioStep[] = customerMessages.map((text) => ({ text }))
    const expect: NonNullable<ScenarioStep['expect']> = {}
    if (saveRule === 'handoff') expect.handoff = true
    if (saveRule === 'nohandoff') expect.handoff = false
    const forbid = saveForbid.split(',').map((x) => x.trim()).filter(Boolean)
    if (forbid.length) expect.forbidText = forbid
    if (Object.keys(expect).length) steps[steps.length - 1].expect = expect
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/test-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: saveTitle.trim(), steps }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage(json.error || 'No se pudo guardar.')
        return
      }
      setSaveTitle('')
      setSaveForbid('')
      setSaveRule('none')
      setMessage('Prueba guardada. Se ejecuta con las demás.')
      await loadSaved()
    } catch {
      setMessage('No se pudo guardar. Intentá de nuevo.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function removeSaved(id: string) {
    if (!window.confirm('¿Borrar esta prueba guardada?')) return
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/test-cases/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) setMessage('No se pudo borrar.')
    } catch {
      setMessage('No se pudo borrar.')
    }
    await loadSaved()
  }

  async function compare() {
    if (!socialAccountId || !cmpText.trim() || !cmpModel) return
    setCmpBusy(true)
    setCmpError(null)
    setCmpOut(null)
    const step: ScenarioStep = { text: cmpText.trim() }
    try {
      const [a, b] = await Promise.all([
        playStep({ agentId, socialAccountId, sessionId: crypto.randomUUID(), step, history: [] }),
        playStep({ agentId, socialAccountId, sessionId: crypto.randomUUID(), step, history: [], modelOverride: cmpModel }),
      ])
      setCmpOut({ a, b })
    } catch (e) {
      setCmpError(e instanceof Error ? e.message : 'Error')
    } finally {
      setCmpBusy(false)
    }
  }

  const groups = (Object.keys(GROUP_LABELS) as ScenarioGroup[]).map((g) => ({
    group: g,
    items: BUILT_IN_SCENARIOS.filter((s) => s.group === g),
  }))
  const done = Object.values(results).filter((r) => r.status === 'done' && r.scored && !r.notRun)
  const passedCount = done.filter((r) => r.pass).length
  // Only models that are set up on the server (a model without its key would always fail).
  const otherModels = (CHAT_AGENT_MODEL_ALLOWLIST as readonly string[]).filter(
    (m) => m !== agentModel && (!configuredModels || configuredModels.includes(m)),
  )

  return (
    <div data-testid="probar-extras">
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]" data-testid="probar-mode-badge">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-800">
          Modo del agente: {MODE_LABEL[operationMode ?? ''] ?? operationMode ?? '—'}
        </span>
        {agentModel ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">Modelo: {agentModel}</span> : null}
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">Probar no envía nada a nadie</span>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Escenarios listos</h3>
            <p className="text-[11.5px] text-slate-500">
              Conversaciones típicas con revisión automática de seguridad. Se juzga lo que el agente <em>respondería</em>, aunque todavía
              esté en borrador o en modo solo humanos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <button type="button" className={btn} onClick={() => (stopRef.current = true)}>
                Detener
              </button>
            ) : null}
            <button type="button" className={btnPrimary} disabled={!ready || running || singleBusy} onClick={() => void runAll()} data-testid="probar-run-all">
              {running ? 'Ejecutando…' : `Ejecutar todas (${BUILT_IN_SCENARIOS.length + saved.length})`}
            </button>
          </div>
        </div>
        {done.length ? (
          <p className="mt-2 text-[12px] text-slate-700" data-testid="probar-summary">
            {passedCount} de {done.length} pasaron
          </p>
        ) : null}
        {!socialAccountId ? <p className="mt-2 text-[12px] text-amber-800">Elegí un canal de WhatsApp para probar.</p> : null}
        {groups.map(({ group, items }) => (
          <div key={group} className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{GROUP_LABELS[group]}</p>
            <ul className="mt-1 space-y-1.5">
              {items.map((s) => (
                <ScenarioRow
                  key={s.id}
                  s={s}
                  r={results[s.id]}
                  isOpen={open === s.id}
                  canRun={ready && !running && !singleBusy}
                  canEdit={canEdit}
                  onRun={() => void runOne(s)}
                  onToggle={() => setOpen(open === s.id ? null : s.id)}
                />
              ))}
            </ul>
          </div>
        ))}
        {message ? <p className="mt-2 text-[12px] text-slate-800" role="status">{message}</p> : null}
      </div>

      <div className={card} data-testid="probar-saved">
        <h3 className="text-sm font-semibold text-slate-900">Mis pruebas</h3>
        <p className="text-[11.5px] text-slate-500">
          Guardá una conversación que salió mal (o muy bien) para repetirla después de cada cambio.
        </p>
        {!savedReady ? (
          <p className="mt-2 text-[12px] text-slate-500">Se activa con la próxima actualización.</p>
        ) : (
          <>
            {saved.length ? (
              <ul className="mt-2 space-y-1.5">
                {saved.map((c) => {
                  const id = `saved:${c.id}`
                  return (
                    <ScenarioRow
                      key={c.id}
                      s={{ id, title: c.title, steps: c.steps }}
                      r={results[id]}
                      isOpen={open === id}
                      custom
                      canRun={ready && !running && !singleBusy}
                      canEdit={canEdit}
                      onRun={() => void runOne({ id, title: c.title, steps: c.steps })}
                      onToggle={() => setOpen(open === id ? null : id)}
                      onDelete={() => void removeSaved(c.id)}
                    />
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-slate-500">Todavía no guardaste ninguna.</p>
            )}
            <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-2">
              <p className="text-[12px] font-medium text-slate-800">
                Guardar la conversación de arriba ({customerMessages.length} mensaje{customerMessages.length === 1 ? '' : 's'} del cliente)
              </p>
              {customerMessages.length > MAX_SAVE_MESSAGES ? (
                <p className="text-[11.5px] text-amber-800">Una prueba admite hasta {MAX_SAVE_MESSAGES} mensajes del cliente: empezá una conversación nueva.</p>
              ) : null}
              <input
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                maxLength={80}
                placeholder="Nombre de la prueba"
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12.5px] !text-slate-900"
                aria-label="Nombre de la prueba"
              />
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-700">
                <select value={saveRule} onChange={(e) => setSaveRule(e.target.value as typeof saveRule)} className="rounded-md border border-slate-300 bg-white px-2 py-1 !text-slate-900" aria-label="Regla">
                  <option value="none">Solo reglas de seguridad</option>
                  <option value="handoff">Debe pasar a una persona</option>
                  <option value="nohandoff">No debe pasar a una persona</option>
                </select>
                <input
                  value={saveForbid}
                  onChange={(e) => setSaveForbid(e.target.value)}
                  placeholder="No debe decir… (separá con coma)"
                  className="min-w-[200px] flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 !text-slate-900"
                  aria-label="Frases prohibidas"
                />
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={saving || !canEdit || customerMessages.length === 0 || customerMessages.length > MAX_SAVE_MESSAGES || !saveTitle.trim()}
                  onClick={() => void saveCurrent()}
                >
                  Guardar prueba
                </button>
              </div>
              <p className="text-[11px] text-slate-500">Se guardan solo los mensajes de texto del cliente (no fotos, audios ni ajustes de la ventana). No pegues datos reales de clientes: los teléfonos y correos se ocultan al guardar.</p>
            </div>
          </>
        )}
      </div>

      <div className={card} data-testid="probar-compare">
        <h3 className="text-sm font-semibold text-slate-900">Comparar modelos</h3>
        <p className="text-[11.5px] text-slate-500">El mismo mensaje con el modelo actual y con otro, lado a lado. No cambia el agente.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={cmpText}
            onChange={(e) => setCmpText(e.target.value)}
            className="min-w-[220px] flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12.5px] !text-slate-900"
            aria-label="Mensaje a comparar"
          />
          <select value={cmpModel} onChange={(e) => setCmpModel(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12.5px] !text-slate-900" aria-label="Comparar con">
            <option value="">Comparar con…</option>
            {otherModels.map((m) => (
              <option key={m} value={m}>
                {modelLabel(m)}
              </option>
            ))}
          </select>
          <button type="button" className={btnPrimary} disabled={!ready || cmpBusy || !cmpModel || !cmpText.trim()} onClick={() => void compare()}>
            {cmpBusy ? 'Comparando…' : 'Comparar'}
          </button>
        </div>
        {cmpError ? <p className="mt-2 text-[12px] text-red-700">{cmpError}</p> : null}
        {cmpOut ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[cmpOut.a, cmpOut.b].map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-2 text-[12.5px]">
                <p className="font-mono text-[11.5px] text-slate-600">{r.model}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-900">{r.text || '(no respondió)'}</p>
                <p className="mt-2 text-[11px] text-slate-500">
                  {(r.latencyMs ?? 0) > 0 ? `${((r.latencyMs ?? 0) / 1000).toFixed(1)} s · ` : ''}
                  {r.escalate || r.needsHuman ? ' · pasa a una persona' : ''}
                  {r.fallbackUsed ? ' · el modelo falló (respuesta de respaldo)' : ''}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
