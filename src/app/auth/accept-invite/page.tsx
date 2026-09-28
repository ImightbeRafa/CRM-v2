'use client'

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react'
import { AuthShell } from '@/components/aurora/auth/AuthShell'
import { auroraBtnPrimary, auroraBtnSecondary, auroraInputClass, auroraLabelClass } from '@/components/aurora/ui/aurora-form'
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
    return `Unite a ${preview.tenantName}`
  }, [preview])

  return (
    <AuthShell
      title={headline}
      subtitle={
        preview ? `Invitación para ${preview.email} · rol ${preview.role}` : error ? undefined : 'Revisando tu invitación…'
      }
    >
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          {error}
        </p>
      ) : null}

      {!error && preview ? (
        <div className="space-y-4">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              signIn('google', { callbackUrl: `/auth/accept-invite?token=${encodeURIComponent(token)}` })
            }
            className={`${auroraBtnSecondary} w-full`}
          >
            Continuar con Google
          </button>

          <div className="relative py-1 text-center text-[11px] uppercase tracking-wide text-slate-400">
            <span className="bg-white px-2">o con email</span>
          </div>

          <form onSubmit={onCredentials} className="space-y-3">
            <div>
              <label htmlFor="invite-email" className={auroraLabelClass}>
                Email
              </label>
              <input id="invite-email" type="email" value={email} readOnly className={`${auroraInputClass} bg-slate-50`} />
            </div>
            <div>
              <label htmlFor="invite-password" className={auroraLabelClass}>
                Contraseña
              </label>
              <input
                id="invite-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseña (si ya tenés cuenta)"
                autoComplete="current-password"
                className={auroraInputClass}
              />
            </div>
            <button type="submit" disabled={busy || !password} className={`${auroraBtnPrimary} w-full`}>
              Entrar y unirme
            </button>
          </form>

          {status === 'authenticated' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void acceptWhileLoggedIn()}
              className={`${auroraBtnSecondary} w-full`}
            >
              Ya iniciaste sesión — unirme ahora
            </button>
          ) : null}
        </div>
      ) : null}
    </AuthShell>
  )
}


export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Cargando invitación…</div>}>
      <AcceptInviteInner />
    </Suspense>
  )
}
