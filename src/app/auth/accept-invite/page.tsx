'use client'

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

type InvitePreview = {
  email: string
  role: string
  tenantName: string
}

function AcceptInviteInner() {
  const params = useSearchParams()
  const token = params.get('token') || ''
  const router = useRouter()
  const { data: session, status } = useSession()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!token) {
      setError('Falta el token de invitación')
      return
    }
    document.cookie = `betsy_team_invite=${encodeURIComponent(token)}; path=/; max-age=${7 * 24 * 3600}; samesite=lax`
    fetch(`/api/invites/accept?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.error || 'Invitación inválida')
        setPreview(json.data)
      })
      .catch((e) => setError(e.message || 'Invitación inválida'))
  }, [token])

  const email = preview?.email || ''

  async function acceptWhileLoggedIn() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo aceptar')
      router.replace('/dashboard')
      router.refresh()
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (status === 'authenticated' && preview && token) {
      void acceptWhileLoggedIn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, preview?.email, token])

  async function onCredentials(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setBusy(true)
    setError(null)
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    if (result?.error) {
      setError('Credenciales inválidas. Si es tu primera vez, usa Google o pide que te creen contraseña.')
      setBusy(false)
      return
    }
    // session effect will accept
    setBusy(false)
  }

  const headline = useMemo(() => {
    if (!preview) return 'Aceptar invitación'
    return `Únete a ${preview.tenantName}`
  }, [preview])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">{headline}</h1>
        {preview ? (
          <p className="mt-2 text-sm text-slate-600">
            Invitación para <strong>{preview.email}</strong> · rol <strong>{preview.role}</strong>
          </p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        {!error && preview ? (
          <div className="mt-6 space-y-4">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                signIn('google', { callbackUrl: `/auth/accept-invite?token=${encodeURIComponent(token)}` })
              }
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Continuar con Google
            </button>

            <div className="relative py-2 text-center text-xs uppercase tracking-wide text-slate-400">
              <span className="bg-white px-2">o email</span>
            </div>

            <form onSubmit={onCredentials} className="space-y-3">
              <input
                type="email"
                value={email}
                readOnly
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseña (si ya tienes cuenta)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={busy || !password}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Entrar y unirme
              </button>
            </form>

            {status === 'authenticated' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void acceptWhileLoggedIn()}
                className="w-full rounded-lg border border-indigo-200 px-4 py-2 text-sm text-indigo-700"
              >
                Ya iniciaste sesión — unirme ahora
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}


export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Cargando invitación…</div>}>
      <AcceptInviteInner />
    </Suspense>
  )
}
