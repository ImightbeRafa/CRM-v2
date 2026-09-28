'use client'

import { signIn } from "next-auth/react"
import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { trackMetaEvent } from "@/app/components/MetaPixel"
import { safeReturnPath } from "@/lib/safe-return-path"
import {
  AuthShell,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
  authLinkClass,
  authErrorClass,
} from "@/components/aurora/auth/AuthShell"

function SignInPageInner() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const searchParams = useSearchParams()
  const intendedPlan = (searchParams?.get('plan') || '').toLowerCase()
  const signupMode = searchParams?.get('signup') === 'true'

  // Where credentials / Google login lands: a validated same-origin path (open-redirect safe).
  const returnTo = () =>
    safeReturnPath(searchParams?.get('callbackUrl') ?? searchParams?.get('next'), {
      origin: window.location.origin,
    })
  
  useEffect(() => {
    if (signupMode) {
      setIsRegistering(true)
    }
  }, [signupMode])

  // If user lands here with a plan param and later signs in, attempt to apply it
  const applyPlanIfRequested = async () => {
    if (!intendedPlan) return
    try {
      const res = await fetch('/api/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: intendedPlan })
      })
      const json = await res.json()
      // Non-blocking; continue regardless
      if (res.ok && json.status === 'success') {
        // If there is a checkout URL, redirect there; otherwise proceed to billing
        if (json.data?.checkoutUrl) {
          window.location.href = json.data.checkoutUrl
          return
        }
      }
    } catch (e) {
      // ignore
    }
    // Default redirect
    window.location.href = '/config?tab=billing'
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    try {
      const eventId = crypto.randomUUID()
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Event-Id': eventId },
        body: JSON.stringify({ email, password, name: name || email.split('@')[0] })
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        setError(data.error || 'Error al registrarse')
        setLoading(false)
        return
      }
      
      // Auto sign in after registration
      const signInRes = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/dashboard'
      })
      
      if (!signInRes || signInRes.error) {
        setError('Registro exitoso. Por favor inicia sesión.')
        setLoading(false)
        setIsRegistering(false)
        return
      }

      trackMetaEvent('CompleteRegistration', { event_id: eventId })

      if (intendedPlan && intendedPlan !== 'free') {
        const tilopayLinks: { [key: string]: string } = {
          'basic': 'https://tp.cr/l/TkRFME9RPT18MQ==',
          'pro': 'https://tp.cr/l/TkRFMU1BPT18MQ=='
        }
        
        if (tilopayLinks[intendedPlan]) {
          window.location.href = tilopayLinks[intendedPlan]
          return
        }
      }
      
      window.location.href = '/dashboard'
    } catch (err) {
      setError('Error al conectar con el servidor')
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (isRegistering) {
      await handleRegister(e)
      return
    }
    
    setLoading(true)
    setError(null)
    const destination = returnTo()
    const res = await signIn('credentials', {
      email: email,
      password,
      redirect: false,
      callbackUrl: destination
    })
    setLoading(false)
    if (!res || res.error) {
      setError('Credenciales inválidas')
      return
    }
    if (intendedPlan) {
      await applyPlanIfRequested()
      return
    }
    window.location.href = destination
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)
    try {
      // After Google, NextAuth redirects to the callback; a plan param keeps its dedicated destination.
      const callbackUrl = intendedPlan ? `/dashboard?plan=${encodeURIComponent(intendedPlan)}` : returnTo()
      await signIn('google', { callbackUrl })
    } catch (error) {
      setError('Error al iniciar sesión con Google')
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title={isRegistering ? 'Crear cuenta' : 'Iniciar sesión'}
      subtitle={
        isRegistering
          ? `Regístrate ${intendedPlan && intendedPlan !== 'free' ? `para el plan ${intendedPlan.toUpperCase()}` : 'gratis'}`
          : 'Usa tu correo electrónico y contraseña'
      }
      footer={<>© {new Date().getFullYear()} BetsyCRM. Todos los derechos reservados.</>}
    >
      {intendedPlan && intendedPlan !== 'free' && isRegistering && (
        <div className="mb-4 rounded-xl border border-au-line-d9d2ff bg-au-tint-f1eeff p-3">
          <p className="text-[13px] text-au-ink-4b36b8">
            ✨ Después del registro, serás redirigido al pago seguro de Tilopay
          </p>
        </div>
      )}
      <form className="space-y-4" onSubmit={handleSubmit}>
        {isRegistering && (
          <div>
            <label className={authLabelClass}>Nombre (opcional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={authInputClass}
              placeholder="Tu nombre"
            />
          </div>
        )}
        <div>
          <label className={authLabelClass}>Correo Electrónico</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
            placeholder="tu@email.com"
            required
          />
        </div>
        <div>
          <label className={authLabelClass}>Contraseña</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${authInputClass} pr-10`}
              placeholder={isRegistering ? "Mínimo 8 caracteres, mayúscula y número" : ""}
              minLength={isRegistering ? 6 : undefined}
              required
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
          {!isRegistering && (
            <div className="mt-1 flex justify-end">
              <Link
                href="/auth/forgot-password"
                className={`${authLinkClass} inline-flex min-h-[44px] items-center py-2 text-[13px]`}
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
          )}
        </div>
        {error && <p className={authErrorClass} role="alert">{error}</p>}
        <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
          {loading
            ? (isRegistering ? 'Registrando…' : 'Ingresando…')
            : (isRegistering ? 'Crear Cuenta' : 'Ingresar')
          }
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setIsRegistering(!isRegistering)}
            className={`${authLinkClass} inline-flex min-h-[44px] items-center py-3 text-[13px]`}
          >
            {isRegistering
              ? '¿Ya tienes cuenta? Inicia sesión'
              : '¿No tienes cuenta? Regístrate'
            }
          </button>
        </div>

        {/* Divider */}
        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <div className="relative flex justify-center text-[12px]">
            <span className="bg-white px-2 text-slate-400">O continúa con</span>
          </div>
        </div>

        {/* Google Sign In Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className={authSecondaryButtonClass}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {loading ? 'Conectando…' : 'Continuar con Google'}
        </button>
      </form>
    </AuthShell>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="aurora-light flex min-h-dvh items-center justify-center bg-[var(--aurora-canvas)] px-4">
        <div className="w-full max-w-[420px] rounded-2xl border border-slate-200/70 bg-white p-8 shadow-sm">
          <div className="mx-auto mb-4 h-8 w-24 animate-pulse rounded bg-slate-100"></div>
          <div className="mx-auto h-6 w-3/4 animate-pulse rounded bg-slate-100"></div>
        </div>
      </div>
    }>
      <SignInPageInner />
    </Suspense>
  )
}
