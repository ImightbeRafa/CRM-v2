'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import {
  AuthShell,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  authLinkClass,
  authErrorClass,
  authSuccessClass,
} from '@/components/aurora/auth/AuthShell'

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  // Read once, then drop it from the address bar (history, screenshots, Referer).
  const [token] = useState(() => searchParams?.get('token') || '')
  useEffect(() => {
    if (token && window.location.search.includes('token=')) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [token])

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <AuthShell
        brandPanel={false}
        title="Enlace inválido"
        subtitle="Este enlace no es válido. Solicita uno nuevo desde la página de inicio de sesión."
      >
        <Link href="/auth/forgot-password" className={authPrimaryButtonClass}>
          Solicitar nuevo enlace
        </Link>
      </AuthShell>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Error al restablecer la contraseña.')
        return
      }

      setSuccess(true)
    } catch {
      setError('Error al conectar con el servidor. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Nueva contraseña"
      subtitle="Ingresa tu nueva contraseña."
      footer={<>© {new Date().getFullYear()} BetsyCRM. Todos los derechos reservados.</>}
    >
      {success ? (
        <div className="space-y-4">
          <div className={authSuccessClass}>
            Tu contraseña fue actualizada exitosamente. Ya puedes iniciar sesión con tu nueva contraseña.
          </div>
          <Link href="/auth/signin" className={authPrimaryButtonClass}>
            Iniciar sesión
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className={authLabelClass}>Nueva contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${authInputClass} pr-10`}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
                autoFocus
              />
              <button
                type="button"
                className="absolute right-0 top-0 flex h-full items-center px-3 text-slate-400 hover:text-slate-700"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className={authLabelClass}>Confirmar contraseña</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={authInputClass}
              placeholder="Repite tu contraseña"
              minLength={6}
              required
            />
          </div>

          {error && <p className={authErrorClass} role="alert">{error}</p>}

          <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
            {loading ? 'Guardando...' : 'Restablecer contraseña'}
          </button>

          <div className="text-center">
            <Link href="/auth/signin" className={`${authLinkClass} inline-block py-2 text-[13px]`}>
              Volver a iniciar sesión
            </Link>
          </div>
        </form>
      )}
    </AuthShell>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="aurora-light flex min-h-dvh items-center justify-center bg-[var(--aurora-canvas)] px-4">
          <div className="w-full max-w-[420px] rounded-2xl border border-slate-200/70 bg-white p-8 shadow-sm">
            <div className="mx-auto mb-4 h-8 w-24 animate-pulse rounded bg-slate-100" />
            <div className="mx-auto h-6 w-3/4 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  )
}
