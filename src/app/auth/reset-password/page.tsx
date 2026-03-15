'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import BetsyLogo from '@/BetsyLogo.png'

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  const token = searchParams?.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
        <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-6 shadow-md">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900">Enlace inválido</h2>
            <p className="mt-2 text-gray-600">
              Este enlace no es válido. Solicita uno nuevo desde la página de inicio de sesión.
            </p>
            <Link
              href="/auth/forgot-password"
              className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-800 py-2"
            >
              Solicitar nuevo enlace
            </Link>
          </div>
        </div>
      </div>
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
            Nueva contraseña
          </h2>
          <p className="mt-2 text-gray-600">
            Ingresa tu nueva contraseña.
          </p>
        </div>

        {success ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                Tu contraseña fue actualizada exitosamente. Ya puedes iniciar sesión con tu nueva contraseña.
              </p>
            </div>
            <div className="text-center">
              <Link
                href="/auth/signin"
                className="inline-block w-full bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 text-center"
              >
                Iniciar sesión
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Nueva contraseña
              </label>
              <div className="relative mt-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 pr-10 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                  required
                  autoFocus
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
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Confirmar contraseña
              </label>
              <div className="relative mt-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 pr-10 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Repite tu contraseña"
                  minLength={6}
                  required
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Restablecer contraseña'}
            </button>

            <div className="text-center mt-4">
              <Link
                href="/auth/signin"
                className="text-sm text-blue-600 hover:text-blue-800 py-2 inline-block"
              >
                Volver a iniciar sesión
              </Link>
            </div>
          </form>
        )}
      </div>
      <footer className="mt-8 text-center text-gray-500 text-sm">
        © {new Date().getFullYear()} BetsyCRM. Todos los derechos reservados.
      </footer>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
          <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-6 shadow-md">
            <div className="text-center">
              <div className="animate-pulse h-16 w-16 bg-gray-200 rounded mx-auto mb-6" />
              <div className="animate-pulse h-8 bg-gray-200 rounded w-3/4 mx-auto" />
            </div>
          </div>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  )
}
