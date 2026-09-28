'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  AuthShell,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
  authLinkClass,
  authSuccessClass,
} from '@/components/aurora/auth/AuthShell'
import { CheckCircle2, XCircle, Loader2, Mail, ArrowLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'

function VerifyEmailPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'pending'>('pending')
  const [message, setMessage] = useState<string>('')
  const [resending, setResending] = useState(false)
  const email = searchParams?.get('email') || ''
  const token = searchParams?.get('token')

  useEffect(() => {
    if (token) {
      verifyEmail(token)
    }
  }, [token])

  const verifyEmail = async (verificationToken: string) => {
    setStatus('loading')
    try {
      const response = await fetch(`/api/auth/verify-email?token=${verificationToken}`)
      const data = await response.json()

      if (response.ok && data.success) {
        setStatus('success')
        setMessage('Tu correo ha sido verificado exitosamente. Redirigiendo al dashboard...')
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 1500)
      } else {
        setStatus('error')
        setMessage(data.error || 'La verificación falló. El enlace puede ser inválido o haber expirado.')
      }
    } catch (error) {
      setStatus('error')
      setMessage('Ocurrió un error durante la verificación. Intenta de nuevo.')
      console.error('Verification error:', error)
    }
  }

  const resendVerificationEmail = async () => {
    if (!email) {
      setMessage('Se necesita una dirección de correo para reenviar el email de verificación.')
      return
    }

    setResending(true)
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      if (!response.ok) {
        let errorMessage = 'No se pudo reenviar el email de verificación.'
        try {
          const data = await response.json()
          errorMessage = data.error || data.message || errorMessage
        } catch {
          // use default
        }
        setStatus('error')
        setMessage(errorMessage)
        return
      }

      const data = await response.json()
      setStatus('pending')
      setMessage(data.message || 'Email de verificación enviado. Revisa tu bandeja de entrada.')
    } catch (error) {
      setStatus('error')
      setMessage('Ocurrió un error. Intenta de nuevo.')
      console.error('Resend error:', error)
    } finally {
      setResending(false)
    }
  }

  const resendButton = email ? (
    <button
      type="button"
      onClick={resendVerificationEmail}
      className={authSecondaryButtonClass}
      disabled={resending}
    >
      {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      Reenviar Email de Verificación
    </button>
  ) : null

  const backLink = (
    <Link href="/auth/signin" className={`${authLinkClass} inline-flex items-center justify-center gap-1.5 py-2 text-[13px]`}>
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Volver a Iniciar sesión
    </Link>
  )

  if (status === 'success') {
    return (
      <AuthShell
        brandPanel={false}
        icon={
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
        }
        title="Email Verificado"
        subtitle={message}
      >
        <div className="space-y-3 text-center">
          <p className="text-[13px] text-slate-500">Redirigiendo al dashboard...</p>
          <Link href="/dashboard" className={authPrimaryButtonClass}>
            Ir al Dashboard
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (status === 'error') {
    return (
      <AuthShell
        brandPanel={false}
        icon={
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <XCircle className="h-6 w-6" aria-hidden />
          </span>
        }
        title="Verificación Fallida"
        subtitle={message}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[13px] font-medium text-amber-800">Qué puedes hacer:</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-[13px] text-amber-700">
              <li>Verifica que usaste el enlace del email más reciente</li>
              <li>Los enlaces de verificación expiran en 24 horas</li>
              <li>Si el enlace expiró, solicita uno nuevo abajo</li>
            </ul>
          </div>
          {resendButton}
          <div className="text-center">{backLink}</div>
        </div>
      </AuthShell>
    )
  }

  if (status === 'loading') {
    return (
      <AuthShell
        brandPanel={false}
        icon={<Loader2 className="h-10 w-10 animate-spin text-au-ink-5b6cff" aria-hidden />}
        title="Verificando Email..."
        subtitle="Espera mientras verificamos tu dirección de correo."
      >
        <span className="sr-only" role="status">Verificando</span>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      brandPanel={false}
      icon={
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-au-tint-f1eeff text-au-ink-5b3fe0">
          <Mail className="h-6 w-6" aria-hidden />
        </span>
      }
      title="Verifica tu Email"
      subtitle={
        email
          ? `Enviamos un enlace de verificación a ${email}`
          : 'Revisa tu correo para el enlace de verificación'
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-au-line-d9d2ff bg-au-tint-f1eeff p-4">
          <p className="text-[13px] font-medium text-au-ink-4b36b8">Pasos a seguir:</p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-[13px] text-au-ink-4b36b8">
            <li>Revisa tu bandeja de entrada (y la carpeta de spam)</li>
            <li>Haz clic en el enlace de verificación del email</li>
            <li>Serás redirigido de vuelta para completar la verificación</li>
          </ol>
        </div>

        {resendButton}

        {message && <div className={`${authSuccessClass} text-center`}>{message}</div>}

        <div className="border-t border-slate-100 pt-2 text-center">{backLink}</div>
      </div>
    </AuthShell>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <AuthShell
        brandPanel={false}
        icon={<Loader2 className="h-10 w-10 animate-spin text-au-ink-5b6cff" aria-hidden />}
        title="Cargando..."
      >
        <span className="sr-only" role="status">Cargando</span>
      </AuthShell>
    }>
      <VerifyEmailPageInner />
    </Suspense>
  )
}
