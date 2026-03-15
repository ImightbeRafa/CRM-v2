'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import BetsyLogo from '@/BetsyLogo.png'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })

      if (!res.ok) {
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
            Recuperar contraseña
          </h2>
          <p className="mt-2 text-gray-600">
            Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
          </p>
        </div>

        {submitted ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                Si el correo existe en nuestro sistema, recibirás un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada y spam.
              </p>
            </div>
            <div className="text-center">
              <Link
                href="/auth/signin"
                className="text-sm text-blue-600 hover:text-blue-800 py-2 inline-block"
              >
                Volver a iniciar sesión
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Correo Electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="tu@email.com"
                required
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
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
