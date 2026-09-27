'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

type AuroraModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
  /** Sticky action row (buttons). */
  footer?: ReactNode
  size?: 'sm' | 'md'
  /** Prevent closing via overlay / Esc while a request is running. */
  busy?: boolean
  /** Extra classes for the content card (e.g. custom widths). */
  className?: string
  role?: 'dialog' | 'alertdialog'
}

/**
 * Aurora modal: white `rounded-2xl` card on desktop, full-height sheet below `md`.
 * Radix Dialog provides the focus trap, Esc and aria wiring.
 */
export function AuroraModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy = false,
  className = '',
  role = 'dialog',
}: AuroraModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-slate-900/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          role={role}
          className={`aurora-light fixed inset-0 z-[61] flex flex-col bg-white text-slate-900 shadow-xl outline-none [color-scheme:light] md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[86dvh] md:w-[calc(100%-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl ${
            size === 'sm' ? 'md:max-w-[440px]' : 'md:max-w-[560px]'
          } ${className}`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-[16px] font-semibold leading-tight text-slate-900">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              disabled={busy}
              aria-label="Cerrar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
