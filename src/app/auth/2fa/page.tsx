'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { ShieldCheck } from 'lucide-react'
import { auroraBtnPrimary, auroraInputClass, auroraLabelClass } from '@/components/aurora/ui/aurora-form'
import { safeMfaCallback } from '@/lib/mfa-session'

function TwoFactorForm() {
  const params = useSearchParams()
  const { update } = useSession()
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mustRestart, setMustRestart] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(useRecovery ? { recoveryCode: code } : { code }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(json.error || 'No pudimos verificar el código.')
        if (res.status === 401 || res.status === 429) setMustRestart(true)
        setBusy(false)
        return
      }
      // The session is restored only by NextAuth itself, from the verified challenge. Check that it
      // really came back (retry once); the verify step is safe to repeat (AUTH-50).
      let next = await update()
      if (!next || (next as { mfa?: string }).mfa === 'pending') next = await update()
      if (!next || (next as { mfa?: string }).mfa === 'pending') {
        setError('Código correcto, pero no pudimos abrir la sesión. Tocá Verificar de nuevo.')
        setBusy(false)
        return
      }
      window.location.assign(safeMfaCallback(params.get('callbackUrl'), window.location.origin))
    } catch {
      setError('Sin conexión. Intentá de nuevo.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-[#5B6CFF]">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Verificación en dos pasos</h1>
          <p className="text-[13px] text-slate-500">
            {useRecovery ? 'Ingresá uno de tus códigos de recuperación.' : 'Ingresá el código de 6 dígitos de tu app.'}
          </p>
        </div>
      </div>

      <div>
        <label className={auroraLabelClass} htmlFor="mfa-login-code">
          {useRecovery ? 'Código de recuperación' : 'Código'}
        </label>
        <input
          id="mfa-login-code"
          className={auroraInputClass}
          autoFocus
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={useRecovery ? 13 : 6}
          placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'}
          value={code}
          disabled={mustRestart}
          onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
        />
      </div>

      {error ? (
        <p role="alert" className="text-[12px] text-red-600">
          {error}
        </p>
      ) : null}

      {mustRestart ? (
        <button type="button" className={`${auroraBtnPrimary} w-full`} onClick={() => void signOut({ callbackUrl: '/auth/signin' })}>
          Volver a iniciar sesión
        </button>
      ) : (
        <button
          type="submit"
          className={`${auroraBtnPrimary} w-full`}
          disabled={busy || (useRecovery ? code.trim().length < 10 : code.length !== 6)}
        >
          {busy ? 'Verificando…' : 'Verificar'}
        </button>
      )}

      <div className="flex items-center justify-between text-[12px]">
        <button
          type="button"
          className="font-medium text-[#5B6CFF] underline"
          onClick={() => {
            setUseRecovery((v) => !v)
            setCode('')
            setError('')
          }}
        >
          {useRecovery ? 'Usar el código de la app' : '¿Perdiste el teléfono?'}
        </button>
        <button type="button" className="text-slate-500 underline" onClick={() => void signOut({ callbackUrl: '/auth/signin' })}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

export default function TwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Suspense fallback={null}>
        <TwoFactorForm />
      </Suspense>
    </main>
  )
}
