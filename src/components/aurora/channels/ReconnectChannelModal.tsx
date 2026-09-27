'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import { AuroraModal } from '@/components/aurora/ui/AuroraModal'
import { auroraBtnPrimary, auroraBtnSecondary } from '@/components/aurora/ui/aurora-form'
import { classifyConnectOutcome } from '@/lib/connect-outcome'

export type ReconnectKind = 'reconnect' | 'repair'

type ReconnectChannelModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: ReconnectKind
  /** Resolved line name (custom name, phone or @handle). */
  lineName: string
  platform: 'whatsapp' | 'instagram'
  /** Health label of the line ("Token vencido", "Webhook caído"…). */
  problem?: string
  /** Running the existing action (connect flow / re-subscribe). */
  busy: boolean
  /** Latest status message from the existing action. */
  statusMessage: string
  /** Launches the EXISTING reconnect / repair action. Called synchronously inside the click. */
  onLaunch: () => void
}

/** Reconectar (Instagram / token vencido) and Reparar webhook: confirm + result, no new backend. */
export function ReconnectChannelModal({
  open,
  onOpenChange,
  kind,
  lineName,
  platform,
  problem,
  busy,
  statusMessage,
  onLaunch,
}: ReconnectChannelModalProps) {
  const [attempted, setAttempted] = useState(false)
  const [sawBusy, setSawBusy] = useState(false)
  const baseline = useRef('')

  useEffect(() => {
    if (!open) {
      setAttempted(false)
      setSawBusy(false)
    }
  }, [open])
  useEffect(() => {
    if (busy) setSawBusy(true)
  }, [busy])

  const launch = () => {
    baseline.current = statusMessage
    setSawBusy(false)
    setAttempted(true)
    onLaunch()
  }

  const result = attempted && !busy && (sawBusy || statusMessage !== baseline.current)
  const outcome = result ? classifyConnectOutcome(statusMessage) : null
  const isRepair = kind === 'repair'
  const platformLabel = platform === 'instagram' ? 'Instagram' : 'WhatsApp'

  const copy = isRepair
    ? 'Betsy dejó de recibir avisos de esta línea. Reparamos la suscripción sin perder chats.'
    : platform === 'instagram'
      ? 'Tu sesión de Instagram venció. Reconectá para seguir recibiendo mensajes.'
      : 'La conexión con Meta de esta línea necesita renovarse. Reconectá para seguir recibiendo y enviando mensajes.'

  return (
    <AuroraModal
      open={open}
      onOpenChange={onOpenChange}
      title={isRepair ? 'Reparar línea' : `Reconectar ${platformLabel}`}
      description={lineName}
      size="sm"
      busy={busy}
      footer={
        outcome === 'success' ? (
          <button type="button" className={auroraBtnPrimary} onClick={() => onOpenChange(false)}>
            Listo
          </button>
        ) : (
          <>
            <button type="button" className={auroraBtnSecondary} onClick={() => onOpenChange(false)} disabled={busy}>
              {outcome ? 'Cerrar' : 'Cancelar'}
            </button>
            <button type="button" className={auroraBtnPrimary} onClick={launch} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {isRepair ? 'Reparando…' : 'Conectando…'}
                </>
              ) : outcome ? (
                'Reintentar'
              ) : isRepair ? (
                'Reparar'
              ) : (
                'Reconectar'
              )}
            </button>
          </>
        )
      }
    >
      {outcome ? (
        <div
          role={outcome === 'success' ? 'status' : 'alert'}
          className={`flex gap-3 rounded-2xl border p-4 ${
            outcome === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
          data-testid="reconnect-result"
        >
          {outcome === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          )}
          <p className="text-[13px] leading-relaxed">{statusMessage}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {problem ? (
            <span className="inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
              {problem}
            </span>
          ) : null}
          <p className="text-[14px] leading-relaxed text-slate-700">{copy}</p>
        </div>
      )}
    </AuroraModal>
  )
}
