'use client'

import { toast } from '@/app/hooks/use-toast'

/**
 * Drop-in replacement for window.alert() inside Aurora pages: same message, shown as an
 * Aurora toast (AuroraShell mounts the toaster). Pass `tone` for the colour; without it a
 * leading ✅ → success and ❌/⚠️/"Error"/"no se pudo" → error (older call sites).
 * Non-blocking: alert() returned nothing, so call sites keep the same flow.
 */
export function notify(message: unknown, tone?: 'success' | 'error'): void {
  const text = String(message ?? '').trim()
  if (!text) return
  const isError = tone === 'error' || (!tone && /^(❌|⚠️|⚠)|\berror\b|no se pudo|falló/i.test(text))
  const isSuccess = tone === 'success' || (!tone && /^✅/.test(text))
  const clean = text.replace(/^(✅|❌|⚠️|⚠)\s*/u, '')
  const [title, ...rest] = clean.split('\n')
  toast({
    variant: (isError ? 'destructive' : isSuccess ? 'success' : 'default') as never,
    title: title.slice(0, 140),
    description: rest.join('\n').trim() || undefined,
  })
}
