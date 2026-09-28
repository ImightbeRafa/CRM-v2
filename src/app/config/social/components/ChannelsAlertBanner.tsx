import { AlertCircle, RefreshCw } from 'lucide-react'

export function ChannelsAlertBanner({
  names,
  canRepair,
  repairing,
  onRepair,
  onDiagnose,
}: {
  /** Display names of channels whose webhook is not subscribed. */
  names: string[]
  canRepair: boolean
  repairing: boolean
  onRepair: () => void
  onDiagnose: () => void
}) {
  if (names.length === 0) return null
  const title =
    names.length === 1
      ? `${names[0]} no está recibiendo mensajes`
      : `${names.length} canales no están recibiendo mensajes`
  return (
    <div
      role="alert"
      data-testid="channels-alert-banner"
      className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 sm:flex-row sm:items-center"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
        <AlertCircle className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-red-900">{title}</p>
        <p className="text-[12px] text-red-800/80">
          El webhook no está suscrito
          {names.length > 1 ? ` (${names.join(', ')})` : ''}. Los clientes no ven respuesta hasta que
          lo repares.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onDiagnose}
          className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Ver diagnóstico
        </button>
        {canRepair ? (
          <button
            type="button"
            onClick={onRepair}
            disabled={repairing}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-red-600 px-3 py-2 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {repairing ? 'Reparando…' : 'Reparar webhook'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
