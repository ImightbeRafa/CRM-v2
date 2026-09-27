'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AuroraModal } from './AuroraModal'
import { auroraBtnDanger, auroraBtnPrimary, auroraBtnSecondary, auroraInputClass } from './aurora-form'

export type AuroraConfirmOptions = {
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  /** Typed confirmation: the button unlocks only when this exact text is typed. */
  requireText?: string
}

type AuroraConfirmDialogProps = AuroraConfirmOptions & {
  open: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** One destructive-confirm pattern (delete key / remove member / disconnect line). */
export function AuroraConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'default',
  requireText,
  busy = false,
  onConfirm,
  onCancel,
}: AuroraConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const locked = Boolean(requireText) && typed.trim() !== requireText
  return (
    <AuroraModal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTyped('')
          onCancel()
        }
      }}
      title={title}
      size="sm"
      busy={busy}
      role="alertdialog"
      footer={
        <>
          <button type="button" className={auroraBtnSecondary} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? auroraBtnDanger : auroraBtnPrimary}
            onClick={onConfirm}
            disabled={busy || locked}
          >
            {busy ? 'Un momento…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        {tone === 'danger' ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-slate-600">{description}</div>
      </div>
      {requireText ? (
        <label className="mt-4 block text-[12px] font-medium text-slate-700">
          Escribí <strong className="font-semibold">{requireText}</strong> para confirmar
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={`${auroraInputClass} mt-1`}
            autoComplete="off"
            autoFocus
          />
        </label>
      ) : null}
    </AuroraModal>
  )
}

/**
 * Promise-based confirm: `const ok = await confirm({...})`.
 * Render the returned `dialog` once in the component tree.
 */
export function useAuroraConfirm() {
  const [state, setState] = useState<{ options: AuroraConfirmOptions; resolve: (ok: boolean) => void } | null>(null)

  const confirm = useCallback(
    (options: AuroraConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ options, resolve })
      }),
    [],
  )

  const settle = (ok: boolean) => {
    state?.resolve(ok)
    setState(null)
  }

  const dialog = state ? (
    <AuroraConfirmDialog
      {...state.options}
      open
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null

  return { confirm, dialog }
}
