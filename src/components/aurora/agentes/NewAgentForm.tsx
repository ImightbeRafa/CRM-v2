'use client'

import { TONE_PRESET_LABELS, type ChatAgentTonePreset } from '@/lib/soft-ai/agent-types'
import type { AgentTab } from './agent-url'

export type NewAgentDraft = {
  name: string
  emoji: string
  description: string
  tonePreset: ChatAgentTonePreset
  introductionNames: string
  systemInstructions: string
}

export const EMPTY_NEW_AGENT: NewAgentDraft = {
  name: '',
  emoji: '🤖',
  description: '',
  tonePreset: 'warm_concise',
  introductionNames: '',
  systemInstructions: '',
}

const TONES: ChatAgentTonePreset[] = ['warm_concise', 'formal', 'playful']
const CARD = 'rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5'
const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 placeholder:!text-slate-400 disabled:bg-slate-100'

/** Names typed as "Sofía, Ana" → up to 3 trimmed names (same limit as the saved-agent editor). */
export function parseIntroductionNames(raw: string): string[] {
  return raw
    .split(',')
    .map((n) => n.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 3)
}

/** Draft tabs of "Nuevo agente": Resumen, Personalidad and Líneas. Nothing is saved until Guardar. */
export function NewAgentForm({
  tab,
  draft,
  onChange,
  disabled,
}: {
  tab: AgentTab
  draft: NewAgentDraft
  onChange: (patch: Partial<NewAgentDraft>) => void
  disabled: boolean
}) {
  if (tab === 'resumen') {
    return (
      <div className={CARD} data-testid="new-agent-resumen">
        <h3 className="text-[15px] font-semibold text-[#0E0D17]">Datos del agente</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="new-agent-name" className="text-xs font-medium text-slate-700">
              Nombre interno *
            </label>
            <input
              id="new-agent-name"
              className={FIELD}
              value={draft.name}
              maxLength={80}
              disabled={disabled}
              placeholder="Ej. Patchy"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="new-agent-emoji" className="text-xs font-medium text-slate-700">
              Emoji
            </label>
            <input
              id="new-agent-emoji"
              className={`${FIELD} w-20 text-center`}
              value={draft.emoji}
              maxLength={8}
              disabled={disabled}
              onChange={(e) => onChange({ emoji: e.target.value })}
            />
          </div>
        </div>
        <label htmlFor="new-agent-desc" className="mt-3 block text-xs font-medium text-slate-700">
          Descripción
        </label>
        <input
          id="new-agent-desc"
          className={FIELD}
          value={draft.description}
          maxLength={200}
          disabled={disabled}
          placeholder="Para qué sirve este agente"
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <p className="mt-3 text-[12px] text-slate-500">
          Se crea como Borrador: no responde chats hasta que lo actives desde Resumen.
        </p>
      </div>
    )
  }

  if (tab === 'personalidad') {
    return (
      <div className={CARD} data-testid="new-agent-personalidad">
        <h3 className="text-[15px] font-semibold text-[#0E0D17]">Voz</h3>
        <p className="mt-3 text-xs font-medium text-slate-700">Tono</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ tonePreset: t })}
              className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${
                draft.tonePreset === t
                  ? 'bg-[#5B6CFF] text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {TONE_PRESET_LABELS[t]}
            </button>
          ))}
        </div>
        <label htmlFor="new-agent-intro" className="mt-4 block text-xs font-medium text-slate-700">
          Nombres de presentación
        </label>
        <p className="mt-0.5 text-[11px] text-slate-500">1–3 nombres separados por coma (ej. Sofía, Ana).</p>
        <input
          id="new-agent-intro"
          className={FIELD}
          value={draft.introductionNames}
          disabled={disabled}
          onChange={(e) => onChange({ introductionNames: e.target.value })}
        />
        <label htmlFor="new-agent-voz" className="mt-4 block text-xs font-medium text-slate-700">
          Instrucciones de voz
        </label>
        <p className="mt-0.5 text-[11px] text-slate-500">Nunca anulan las reglas fijas de seguridad.</p>
        <textarea
          id="new-agent-voz"
          className={`${FIELD} leading-relaxed`}
          rows={7}
          maxLength={1200}
          value={draft.systemInstructions}
          disabled={disabled}
          onChange={(e) => onChange({ systemInstructions: e.target.value })}
        />
      </div>
    )
  }

  return (
    <div className={CARD} data-testid="new-agent-lineas">
      <h3 className="text-[15px] font-semibold text-[#0E0D17]">Líneas</h3>
      <p className="mt-2 rounded-xl bg-slate-50 px-3 py-3 text-[13px] text-slate-600">
        Guardá el agente para elegir qué líneas atiende. Lista vacía = no atiende a nadie.
      </p>
    </div>
  )
}
