'use client'

import { useCallback, useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { ShieldCheck, ShieldAlert, KeyRound, Copy, Check } from 'lucide-react'
import { ConfigCard } from './ConfigCard'
import { ConfigPanelHeader } from './ConfigPanelHeader'
import {
  auroraBtnDanger,
  auroraBtnPrimary,
  auroraBtnSecondary,
  auroraInputClass,
  auroraLabelClass,
} from '@/components/aurora/ui/aurora-form'

type Status = { available: boolean; enabled: boolean; enabledAt: string | null; recoveryLeft: number }
type Step =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'setup'; secret: string; otpauthUri: string }
  | { kind: 'codes'; codes: string[]; signOutAfter: boolean }
  | { kind: 'disable' }
  | { kind: 'regenerate' }

async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok && json.success !== false, json }
}

function groupKey(secret: string) {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

/** Config › Seguridad: the signed-in user's own two-step login (authenticator app). */
export function SecurityPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/account/2fa', { credentials: 'same-origin', cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success) setStatus(json as Status)
    else setStatus({ available: false, enabled: false, enabledAt: null, recoveryLeft: 0 })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reset = () => {
    setCode('')
    setPassword('')
    setError('')
    setUseRecovery(false)
  }

  const startSetup = async () => {
    setError('')
    setBusy(true)
    const { ok, json } = await post('/api/account/2fa/setup', { password })
    setBusy(false)
    setPassword('')
    if (!ok) return setError(json.error || 'No se pudo iniciar la configuración.')
    setStep({ kind: 'setup', secret: json.secret, otpauthUri: json.otpauthUri })
  }

  const enable = async () => {
    setBusy(true)
    setError('')
    const { ok, json } = await post('/api/account/2fa/enable', { code })
    setBusy(false)
    if (!ok) return setError(json.error || 'Código incorrecto.')
    reset()
    setStep({ kind: 'codes', codes: json.recoveryCodes || [], signOutAfter: true })
  }

  const factorBody = () => (useRecovery ? { recoveryCode: code } : { code })

  const disable = async () => {
    setBusy(true)
    setError('')
    const { ok, json } = await post('/api/account/2fa/disable', { ...factorBody(), password })
    setBusy(false)
    if (!ok) return setError(json.error || 'No se pudo desactivar.')
    await signOut({ callbackUrl: '/auth/signin' })
  }

  const regenerate = async () => {
    setBusy(true)
    setError('')
    const { ok, json } = await post('/api/account/2fa/recovery-codes', factorBody())
    setBusy(false)
    if (!ok) return setError(json.error || 'Código incorrecto.')
    reset()
    setStep({ kind: 'codes', codes: json.recoveryCodes || [], signOutAfter: false })
    void load()
  }

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the codes stay visible to write down */
    }
  }

  const codeField = (label: string) => (
    <div>
      <label className={auroraLabelClass} htmlFor="mfa-code">
        {useRecovery ? 'Código de recuperación' : label}
      </label>
      <input
        id="mfa-code"
        className={auroraInputClass}
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        maxLength={useRecovery ? 13 : 6}
        placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'}
        value={code}
        onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
      />
    </div>
  )

  return (
    <div>
      <ConfigPanelHeader
        title="Seguridad"
        subtitle="Protegé tu cuenta con verificación en dos pasos: además de la contraseña, un código de tu teléfono."
      />

      <ConfigCard className="p-6" data-testid="security-2fa-card">
        {!status ? (
          <p className="text-[13px] text-slate-500">Cargando…</p>
        ) : !status.available ? (
          <p className="text-[13px] text-slate-500">La verificación en dos pasos estará disponible pronto.</p>
        ) : step.kind === 'codes' ? (
          <div className="space-y-4">
            <div className="flex gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900">Guardá tus códigos de recuperación</h2>
                <p className="mt-1 text-[13px] text-slate-600">
                  Si perdés el teléfono, cada código sirve una sola vez para entrar. No los vas a volver a ver:
                  guardalos en un lugar seguro.
                </p>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4 font-mono text-[14px] text-slate-800" data-testid="recovery-codes">
              {step.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={auroraBtnSecondary} onClick={() => void copyCodes(step.codes)}>
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied ? 'Copiados' : 'Copiar'}
              </button>
              <button
                type="button"
                className={auroraBtnPrimary}
                onClick={() =>
                  step.signOutAfter ? void signOut({ callbackUrl: '/auth/signin' }) : setStep({ kind: 'idle' })
                }
              >
                {step.signOutAfter ? 'Ya los guardé: iniciar sesión de nuevo' : 'Listo'}
              </button>
            </div>
            {step.signOutAfter ? (
              <p className="text-[12px] text-slate-500">
                Por seguridad cerramos todas tus sesiones. Al volver a entrar te vamos a pedir el código de la app.
              </p>
            ) : null}
          </div>
        ) : step.kind === 'confirm' ? (
          <div className="space-y-4">
            <p className="text-[13px] text-slate-700">Para empezar, confirmá que sos vos.</p>
            <div>
              <label className={auroraLabelClass} htmlFor="mfa-setup-password">
                Contraseña (si entrás con Google, dejala vacía)
              </label>
              <input
                id="mfa-setup-password"
                type="password"
                autoComplete="current-password"
                className={auroraInputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? <p role="alert" className="text-[12px] text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={auroraBtnSecondary} onClick={() => setStep({ kind: 'idle' })} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className={auroraBtnPrimary} onClick={() => void startSetup()} disabled={busy}>
                Continuar
              </button>
            </div>
          </div>
        ) : step.kind === 'setup' ? (
          <div className="space-y-4">
            <ol className="list-decimal space-y-2 pl-5 text-[13px] text-slate-700">
              <li>Instalá una app de autenticación (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
              <li>
                En el teléfono, tocá{' '}
                <a className="font-medium text-[#5B6CFF] underline" href={step.otpauthUri}>
                  agregar a la app
                </a>{' '}
                o ingresá esta clave a mano:
              </li>
            </ol>
            <code className="block select-all rounded-xl bg-slate-50 p-3 text-center font-mono text-[15px] tracking-wider text-slate-900" data-testid="mfa-secret">
              {groupKey(step.secret)}
            </code>
            <p className="text-[13px] text-slate-700">3. Escribí el código de 6 dígitos que muestra la app:</p>
            {codeField('Código de la app')}
            {error ? <p role="alert" className="text-[12px] text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={auroraBtnSecondary} onClick={() => setStep({ kind: 'idle' })} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className={auroraBtnPrimary} onClick={() => void enable()} disabled={busy || code.length !== 6}>
                Activar
              </button>
            </div>
          </div>
        ) : step.kind === 'disable' || step.kind === 'regenerate' ? (
          <div className="space-y-4">
            <p className="text-[13px] text-slate-700">
              {step.kind === 'disable'
                ? 'Para desactivar la verificación en dos pasos confirmá que sos vos.'
                : 'Los códigos de recuperación anteriores dejarán de funcionar.'}
            </p>
            {step.kind === 'disable' ? (
              <div>
                <label className={auroraLabelClass} htmlFor="mfa-password">
                  Contraseña (si entrás con Google, dejala vacía)
                </label>
                <input
                  id="mfa-password"
                  type="password"
                  autoComplete="current-password"
                  className={auroraInputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : null}
            {codeField('Código de la app')}
            <button
              type="button"
              className="text-[12px] font-medium text-[#5B6CFF] underline"
              onClick={() => {
                setUseRecovery((v) => !v)
                setCode('')
              }}
            >
              {useRecovery ? 'Usar el código de la app' : 'Usar un código de recuperación'}
            </button>
            {error ? <p role="alert" className="text-[12px] text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={auroraBtnSecondary} onClick={() => setStep({ kind: 'idle' })} disabled={busy}>
                Cancelar
              </button>
              <button
                type="button"
                className={step.kind === 'disable' ? auroraBtnDanger : auroraBtnPrimary}
                onClick={() => void (step.kind === 'disable' ? disable() : regenerate())}
                disabled={busy || !code}
              >
                {step.kind === 'disable' ? 'Desactivar' : 'Generar nuevos códigos'}
              </button>
            </div>
          </div>
        ) : status.enabled ? (
          <div className="space-y-4">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900">Verificación en dos pasos activa</h2>
                <p className="mt-1 text-[13px] text-slate-600">
                  Cada vez que inicies sesión te pedimos el código de la app. Te quedan {status.recoveryLeft} códigos de
                  recuperación.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={auroraBtnSecondary} onClick={() => { reset(); setStep({ kind: 'regenerate' }) }}>
                Nuevos códigos de recuperación
              </button>
              <button type="button" className={auroraBtnSecondary} onClick={() => { reset(); setStep({ kind: 'disable' }) }}>
                Desactivar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
              <div>
                <h2 className="text-[15px] font-semibold text-slate-900">Verificación en dos pasos desactivada</h2>
                <p className="mt-1 text-[13px] text-slate-600">
                  Si alguien consigue tu contraseña, puede entrar a tu negocio. Con la verificación en dos pasos también
                  necesita tu teléfono.
                </p>
              </div>
            </div>
            {error ? <p role="alert" className="text-[12px] text-red-600">{error}</p> : null}
            <button type="button" className={auroraBtnPrimary} onClick={() => { reset(); setStep({ kind: 'confirm' }) }} disabled={busy}>
              Activar verificación en dos pasos
            </button>
          </div>
        )}
      </ConfigCard>
    </div>
  )
}
