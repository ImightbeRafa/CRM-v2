'use client'

import { signIn } from "next-auth/react"
import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Button } from "@/app/components/ui/button"
import { Eye, EyeOff } from "lucide-react"
import BetsyLogo from "@/BetsyLogo.png"

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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      
      // If user selected a paid plan, redirect to payment or billing
      if (intendedPlan && intendedPlan !== 'free') {
        // Get the Tilopay link based on plan
        const tilopayLinks: { [key: string]: string } = {
          'basic': 'https://tp.cr/l/TkRFME9RPT18MQ==',
          'pro': 'https://tp.cr/l/TkRFMU1BPT18MQ=='
        }
        
        if (tilopayLinks[intendedPlan]) {
          window.location.href = tilopayLinks[intendedPlan]
          return
        }
      }
      
      // Otherwise, go to dashboard
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
    const res = await signIn('credentials', {
      email: email,
      password,
      redirect: false,
      callbackUrl: '/dashboard'
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
    window.location.href = '/dashboard'
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)
    try {
      // After Google, NextAuth will redirect to /dashboard; we intercept via middleware or plan param on URL
      const callbackUrl = intendedPlan ? `/dashboard?plan=${encodeURIComponent(intendedPlan)}` : '/dashboard'
      await signIn('google', { callbackUrl })
    } catch (error) {
      setError('Error al iniciar sesión con Google')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-6 shadow-md">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <Image 
              src={BetsyLogo} 
              alt="Betsy CRM" 
              width={64}
              height={64}
              className="object-contain"
              priority
            />
          </div>
          <h2 className="mt-2 text-3xl font-bold text-gray-900">
            {isRegistering ? 'Crear Cuenta' : 'Iniciar Sesión'}
          </h2>
          <p className="mt-2 text-gray-600">
            {isRegistering 
              ? `Regístrate ${intendedPlan && intendedPlan !== 'free' ? `para el plan ${intendedPlan.toUpperCase()}` : 'gratis'}` 
              : 'Usa tu correo electrónico y contraseña'
            }
          </p>
          {intendedPlan && intendedPlan !== 'free' && isRegistering && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                ✨ Después del registro, serás redirigido al pago seguro de Tilopay
              </p>
            </div>
          )}
        </div>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {isRegistering && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Nombre (opcional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="Tu nombre"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700">Correo Electrónico</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="tu@email.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Contraseña</label>
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 pr-10 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder={isRegistering ? "Mínimo 6 caracteres" : ""}
                minLength={isRegistering ? 6 : undefined}
                required
              />
              <button
                type="button"
                className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {!isRegistering && (
              <div className="flex justify-end mt-1">
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading 
              ? (isRegistering ? 'Registrando…' : 'Ingresando…')
              : (isRegistering ? 'Crear Cuenta' : 'Ingresar')
            }
          </button>
          
          <div className="text-center mt-4">
            <button
              type="button"
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-sm text-blue-600 hover:text-blue-800 py-2"
            >
              {isRegistering 
                ? '¿Ya tienes cuenta? Inicia sesión' 
                : '¿No tienes cuenta? Regístrate'
              }
            </button>
          </div>

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">O continúa con</span>
            </div>
          </div>

          {/* Google Sign In Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white text-gray-700 px-4 py-2 rounded-lg shadow-sm border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
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
      </div>
      <footer className="mt-8 text-center text-gray-500 text-sm">
        © {new Date().getFullYear()} BetsyCRM. Todos los derechos reservados.
      </footer>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
        <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-6 shadow-md">
          <div className="text-center">
            <div className="animate-pulse h-16 w-16 bg-gray-200 rounded mx-auto mb-6"></div>
            <div className="animate-pulse h-8 bg-gray-200 rounded w-3/4 mx-auto"></div>
          </div>
        </div>
      </div>
    }>
      <SignInPageInner />
    </Suspense>
  )
}