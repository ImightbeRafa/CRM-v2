'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, MessageCircle, AlertTriangle } from 'lucide-react'
import { AuroraModal } from '@/components/aurora/ui/AuroraModal'
import { auroraBtnPrimary, auroraBtnSecondary } from '@/components/aurora/ui/aurora-form'
import { classifyConnectOutcome } from '@/lib/connect-outcome'

type ConnectLineModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** WhatsApp lines already connected (adds the "mismo número = se actualiza" note). */
  existingCount: number
  /** Embedded Signup not available (SDK loading / missing config). */
  disabled: boolean
  disabledReason?: string
  /** True while the existing Embedded Signup flow is running. */
  connecting: boolean
  /** Latest status message set by the existing flow. */
  statusMessage: string
  /** Launches the EXISTING Embedded Signup flow. Called synchronously inside the click. */
  onLaunch: () => void
  /** Opens the advanced manual link form. */
  onManual?: () => void
  /**
   * Meta asked for the direct login (SDK 36008): this button opens it from its own click, since a
   * browser allows one popup per click.
   */
  fallbackAction?: { label: string; onClick: () => void } | null
}

/**
 * "Conectar línea de WhatsApp": explanation -> Meta popup (existing flow) -> result.
 * It never changes the Embedded Signup logic; it only calls `onLaunch` from a user click so the
 * Meta popup keeps its user gesture.
 */
export function ConnectLineModal({
  open,
  onOpenChange,
  existingCount,
  disabled,
  disabledReason,
  connecting,
  statusMessage,
  onLaunch,
  fallbackAction,
  onManual,
}: ConnectLineModalProps) {
  const [attempted, setAttempted] = useState(false)
  const [sawConnecting, setSawConnecting] = useState(false)
  const baseline = useRef('')

  useEffect(() => {
    if (!open) {
      setAttempted(false)
      setSawConnecting(false)
    }
  }, [open])
  useEffect(() => {
    if (connecting) setSawConnecting(true)
  }, [connecting])

  const launch = () => {
    baseline.current = statusMessage
    setSawConnecting(false)
    setAttempted(true)
    onLaunch()
  }

  const showResult = attempted && !connecting && (sawConnecting || statusMessage !== baseline.current)
  const outcome = showResult ? classifyConnectOutcome(statusMessage) : null

  return (
    <AuroraModal
      open={open}
      onOpenChange={onOpenChange}
      title="Conectar línea de WhatsApp"
      description="Sumá un número de WhatsApp Business a Betsy."
      busy={connecting}
      footer={
        outcome === 'success' ? (
          <button type="button" className={auroraBtnPrimary} onClick={() => onOpenChange(false)}>
            Listo
          </button>
        ) : outcome ? (
          <>
            {onManual ? (
              <button
                type="button"
                className={auroraBtnSecondary}
                onClick={() => {
                  onOpenChange(false)
                  onManual()
                }}
              >
                Vincular manualmente
              </button>
            ) : null}
            {fallbackAction ? (
              <button type="button" className={auroraBtnPrimary} onClick={fallbackAction.onClick}>
                {fallbackAction.label}
              </button>
            ) : (
              <button type="button" className={auroraBtnPrimary} onClick={launch} disabled={disabled}>
                Reintentar
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className={auroraBtnSecondary} onClick={() => onOpenChange(false)} disabled={connecting}>
              Cancelar
            </button>
            <button type="button" className={auroraBtnPrimary} onClick={launch} disabled={disabled || connecting}>
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Abriendo Meta…
                </>
              ) : (
                'Continuar con Meta'
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
          data-testid="connect-line-result"
        >
          {outcome === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          )}
          <p className="text-[13px] leading-relaxed">{statusMessage}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <MessageCircle className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-[14px] leading-relaxed text-slate-700">
              Seguí usando WhatsApp Business en tu teléfono. Betsy recibe los mismos chats en la bandeja, así tu
              equipo y la IA responden desde acá sin perder la app.
            </p>
          </div>
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
            Cada número queda como una línea propia con su agente.
          </p>
          {existingCount > 0 ? (
            <p className="text-[12px] text-slate-500">
              Ya tenés {existingCount} {existingCount === 1 ? 'línea conectada' : 'líneas conectadas'}. Un número
              distinto se suma como línea nueva; el mismo número se actualiza (no duplica).
            </p>
          ) : null}
          <p className="text-[12px] text-slate-500">
            Se abre una ventana de Meta para iniciar sesión y elegir el número. Si tu navegador bloquea ventanas
            emergentes, permitilas y volvé a intentar.
          </p>
          {disabled && disabledReason ? (
            <p role="alert" className="text-[12px] text-amber-700">
              {disabledReason}
            </p>
          ) : null}
        </div>
      )}
    </AuroraModal>
  )
}
