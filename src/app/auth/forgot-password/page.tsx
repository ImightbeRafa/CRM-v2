'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AuthShell,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  authLinkClass,
  authErrorClass,
  authSuccessClass,
} from '@/components/aurora/auth/AuthShell'
import { TurnstileWidget } from '@/components/aurora/auth/TurnstileWidget'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReset, setTurnstileReset] = useState(0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), turnstileToken }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.code === 'turnstile') {
          setError(data.error || 'Completa la verificación de seguridad.')
          setTurnstileReset((n) => n + 1)
          return
        }
        throw new Error('Error de red')
      }

      setSubmitted(true)
    } catch {
      setError('Error al conectar con el servidor. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Recuperar contraseña"
      subtitle="Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña."
      footer={<>© {new Date().getFullYear()} BetsyCRM. Todos los derechos reservados.</>}
    >
      {submitted ? (
        <div className="space-y-4">
          <div className={authSuccessClass}>
            Si el correo existe en nuestro sistema, recibirás un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada y spam.
          </div>
          <div className="text-center">
            <Link href="/auth/signin" className={`${authLinkClass} inline-block py-2 text-[13px]`}>
              Volver a iniciar sesión
            </Link>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className={authLabelClass}>Correo Electrónico</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClass}
              placeholder="tu@email.com"
              required
              autoFocus
            />
          </div>

          <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileReset} />
          {error && <p className={authErrorClass} role="alert">{error}</p>}

          <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
            {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
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
