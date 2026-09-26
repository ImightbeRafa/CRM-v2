'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

type AuroraDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  subtitle?: ReactNode
  /** Right side of the header (status chip, actions). */
  headerRight?: ReactNode
  children: ReactNode
  /** Sticky footer (actions). */
  footer?: ReactNode
  /** Tailwind max-width applied from `md` up. */
  widthClass?: string
  /** Accessible name when `title` is not plain text. */
  ariaTitle?: string
}

/**
 * Right-side drawer on desktop, full-screen sheet below `md`.
 * Closes on Esc / backdrop; Radix provides the focus trap.
 */
export function AuroraDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  headerRight,
  children,
  footer,
  widthClass = 'md:max-w-[560px]',
  ariaTitle,
}: AuroraDrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-slate-900/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={`aurora-light fixed inset-0 z-[61] flex flex-col bg-[var(--aurora-canvas)] text-slate-900 shadow-2xl outline-none [color-scheme:light] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right md:inset-y-0 md:left-auto md:right-0 md:w-full ${widthClass}`}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200/70 bg-white px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[17px] font-semibold leading-tight text-slate-900" aria-label={ariaTitle}>
                {title}
              </Dialog.Title>
              {subtitle ? (
                <Dialog.Description className="mt-0.5 text-[12px] text-slate-500">{subtitle}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{ariaTitle ?? 'Detalle'}</Dialog.Description>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerRight}
              <Dialog.Close
                aria-label="Cerrar"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
              >
                <X className="h-4 w-4" aria-hidden />
              </Dialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200/70 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
