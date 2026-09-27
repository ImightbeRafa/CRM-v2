'use client'

import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useToast } from '@/app/hooks/use-toast'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/app/components/ui/toast'

/**
 * Renders the app's existing `useToast()` store in Aurora style (STATE-01 toasts).
 * Mounted once by `AuroraShell`; nothing else in the app rendered these toasts before.
 */
export function AuroraToaster() {
  const { toasts } = useToast()
  return (
    <ToastProvider duration={4500}>
      {toasts.map(({ id, title, description, variant, action, ...props }) => {
        const tone = variant === 'destructive' ? 'danger' : variant === 'success' ? 'success' : 'info'
        const Icon = tone === 'danger' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info
        const iconClass = tone === 'danger' ? 'text-red-500' : tone === 'success' ? 'text-emerald-500' : 'text-[#5B6CFF]'
        return (
          <Toast
            key={id}
            {...props}
            className="aurora-light items-start gap-3 rounded-xl border-slate-200 bg-white p-4 pr-8 text-slate-900 shadow-lg [color-scheme:light]"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden />
            <div className="min-w-0 flex-1 space-y-0.5">
              {title ? <ToastTitle className="text-[13px] text-slate-900">{title}</ToastTitle> : null}
              {description ? (
                <ToastDescription className="text-[12px] text-slate-600 opacity-100">{description}</ToastDescription>
              ) : null}
            </div>
            {action}
            <ToastClose className="text-slate-400 opacity-100 hover:text-slate-700" />
          </Toast>
        )
      })}
      <ToastViewport className="bottom-20 top-auto z-[80] p-3 sm:bottom-4 sm:right-4 md:bottom-4" />
    </ToastProvider>
  )
}
