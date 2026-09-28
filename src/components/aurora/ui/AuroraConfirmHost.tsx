'use client'

import { useEffect, useState } from 'react'
import { AuroraConfirmDialog, type AuroraConfirmOptions } from './AuroraConfirmDialog'

type Request = AuroraConfirmOptions & { resolve: (ok: boolean) => void }

let pushRequest: ((req: Request) => void) | null = null

/** Words that make a confirmation destructive (red button). */
const DESTRUCTIVE = /eliminar|borrar|desactivar|detener|quitar|cancelar|gratuito|restaurar/i

/**
 * Drop-in async replacement for window.confirm() inside Aurora pages:
 * `if (!(await auroraConfirm('¿Eliminar este campo?'))) return`.
 * Falls back to window.confirm when no AuroraShell (host) is mounted.
 */
export function auroraConfirm(message: string, opts?: Partial<AuroraConfirmOptions>): Promise<boolean> {
  if (!pushRequest) return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false)
  const [first, ...rest] = message.trim().split('\n')
  const destructive = DESTRUCTIVE.test(message)
  return new Promise<boolean>((resolve) => {
    pushRequest?.({
      title: opts?.title ?? (first.length <= 80 ? first : 'Confirmar acción'),
      description: opts?.description ?? (first.length <= 80 ? rest.join('\n') || null : message),
      confirmLabel: opts?.confirmLabel ?? (destructive ? 'Sí, continuar' : 'Confirmar'),
      cancelLabel: opts?.cancelLabel ?? 'Cancelar',
      tone: opts?.tone ?? (destructive ? 'danger' : 'default'),
      requireText: opts?.requireText,
      resolve,
    })
  })
}

/** Mounted once by AuroraShell (next to the toaster). */
export function AuroraConfirmHost() {
  const [queue, setQueue] = useState<Request[]>([])

  useEffect(() => {
    pushRequest = (req) => setQueue((q) => [...q, req])
    return () => {
      pushRequest = null
    }
  }, [])

  const current = queue[0]
  const settle = (ok: boolean) => {
    current?.resolve(ok)
    setQueue((q) => q.slice(1))
  }

  if (!current) return null
  return (
    <AuroraConfirmDialog
      open
      title={current.title}
      description={<span className="whitespace-pre-line">{current.description}</span>}
      confirmLabel={current.confirmLabel}
      cancelLabel={current.cancelLabel}
      tone={current.tone}
      requireText={current.requireText}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )
}
