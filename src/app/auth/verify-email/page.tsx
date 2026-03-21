'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/app/components/ui/card'
import { Button } from '@/app/components/ui/button'
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

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="bg-green-100 dark:bg-green-900/30 p-4 rounded-full">
                <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <CardTitle className="text-2xl">Email Verificado</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">Redirigiendo al dashboard...</p>
            <Link href="/dashboard">
              <Button>Ir al Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-0 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <div className="bg-red-100 dark:bg-red-900/30 p-4 rounded-full">
                <XCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <CardTitle className="text-2xl">Verificación Fallida</CardTitle>
            <CardDescription className="text-red-600 dark:text-red-400">{message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Qué puedes hacer:</p>
              <ul className="text-sm text-amber-700 dark:text-amber-400 mt-2 space-y-1 list-disc list-inside">
                <li>Verifica que usaste el enlace del email más reciente</li>
                <li>Los enlaces de verificación expiran en 24 horas</li>
                <li>Si el enlace expiró, solicita uno nuevo abajo</li>
              </ul>
            </div>
            {email && (
              <Button
                onClick={resendVerificationEmail}
                className="w-full"
                variant="outline"
                disabled={resending}
              >
                {resending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Reenviar Email de Verificación
              </Button>
            )}
            <Link href="/auth/signin" className="block">
              <Button variant="ghost" className="w-full text-muted-foreground">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Volver a Iniciar Sesión
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-0 shadow-xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-12 h-12 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <CardTitle className="text-2xl">Verificando Email...</CardTitle>
            <CardDescription>Espera mientras verificamos tu dirección de correo.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-0 shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-4 rounded-full">
              <Mail className="w-12 h-12 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <CardTitle className="text-2xl">Verifica tu Email</CardTitle>
          <CardDescription>
            {email
              ? `Enviamos un enlace de verificación a ${email}`
              : 'Revisa tu correo para el enlace de verificación'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-400">Pasos a seguir:</p>
            <ol className="text-sm text-blue-700 dark:text-blue-400 mt-2 space-y-1 list-decimal list-inside">
              <li>Revisa tu bandeja de entrada (y la carpeta de spam)</li>
              <li>Haz clic en el enlace de verificación del email</li>
              <li>Serás redirigido de vuelta para completar la verificación</li>
            </ol>
          </div>

          {email && (
            <Button
              onClick={resendVerificationEmail}
              className="w-full"
              variant="outline"
              disabled={resending}
            >
              {resending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Reenviar Email de Verificación
            </Button>
          )}

          {message && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
              <p className="text-sm text-green-700 dark:text-green-400">{message}</p>
            </div>
          )}

          <div className="pt-2 border-t border-border">
            <Link href="/auth/signin" className="block">
              <Button variant="ghost" className="w-full text-muted-foreground text-sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Volver a Iniciar Sesión
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-0 shadow-xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-12 h-12 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <CardTitle className="text-2xl">Cargando...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    }>
      <VerifyEmailPageInner />
    </Suspense>
  )
}
