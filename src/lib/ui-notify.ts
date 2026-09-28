'use client'

import { toast } from '@/app/hooks/use-toast'

/**
 * Drop-in replacement for window.alert() inside Aurora pages: same message, shown as an
 * Aurora toast (AuroraShell mounts the toaster). ✅ → success, ❌/⚠️/"Error" → error.
 * Non-blocking: alert() returned nothing, so call sites keep the same flow.
 */
export function notify(message: unknown): void {
  const text = String(message ?? '').trim()
  if (!text) return
  const isError = /^(❌|⚠️|⚠)|\berror\b|no se pudo|falló/i.test(text)
  const isSuccess = /^✅/.test(text)
  const clean = text.replace(/^(✅|❌|⚠️|⚠)\s*/u, '')
  const [title, ...rest] = clean.split('\n')
  toast({
    variant: (isError ? 'destructive' : isSuccess ? 'success' : 'default') as never,
    title: title.slice(0, 140),
    description: rest.join('\n').trim() || undefined,
  })
}
