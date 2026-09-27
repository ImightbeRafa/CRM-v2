'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { AuroraModal } from '@/components/aurora/ui/AuroraModal'
import {
  auroraBtnPrimary,
  auroraBtnSecondary,
  auroraInputClass,
  auroraLabelClass,
} from '@/components/aurora/ui/aurora-form'
import { useToast } from '@/app/hooks/use-toast'
import type { UsersPanelUser } from './panels/UsersPanel'

/** The six real roles, with their existing Spanish descriptions. */
export const INVITE_ROLES: Array<{ value: string; label: string; help: string }> = [
  { value: 'OWNER', label: 'Owner', help: 'Propietario: acceso completo + facturación' },
  { value: 'ADMIN', label: 'Admin', help: 'Administrador: acceso completo' },
  { value: 'MANAGER', label: 'Gerente', help: 'Ventas, producción y estadísticas' },
  { value: 'SALES', label: 'Ventas', help: 'Solo el módulo de ventas' },
  { value: 'PRODUCTION', label: 'Producción', help: 'Solo el módulo de producción' },
  { value: 'VIEWER', label: 'Visualizador', help: 'Solo lectura' },
]

type InviteMemberModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful create / update (reload the team list). */
  onDone: () => void | Promise<void>
  editingUser?: UsersPanelUser | null
}

/**
 * "Invitar persona": Aurora modal over the existing `POST /api/users` (create) and `PUT /api/users`
 * (edit). The temporary password is required today; an email that already exists is added as a
 * membership by the API. There is no emailed-token invite flow.
 */
export function InviteMemberModal({ open, onOpenChange, onDone, editingUser = null }: InviteMemberModalProps) {
  const { toast } = useToast()
  const editing = Boolean(editingUser)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('VIEWER')
  const [password, setPassword] = useState('')
  const [active, setActive] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seatLimit, setSeatLimit] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setEmail(editingUser?.email ?? '')
    setUsername(editingUser?.username ?? '')
    setRole(editingUser?.role && INVITE_ROLES.some((r) => r.value === editingUser.role) ? editingUser.role : 'VIEWER')
    setPassword('')
    setActive(editingUser?.active !== false)
    setShowPassword(false)
    setError(null)
    setSeatLimit(null)
  }, [open, editingUser])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSeatLimit(null)
    if (!editing && password.length < 8) {
      setError('La contraseña temporal necesita al menos 8 caracteres, con mayúscula, minúscula y número.')
      return
    }
    setBusy(true)
    try {
      const body = editing
        ? {
            id: editingUser!.id,
            email,
            username,
            role,
            active,
            ...(password ? { password } : {}),
          }
        : { email, username, role, active, password }
      const res = await fetch('/api/users', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 402) {
        // Real seat limit from the API: `{ currentCount, limit }`.
        setSeatLimit(json.error || `Límite de usuarios alcanzado (${json.currentCount}/${json.limit}).`)
        return
      }
      if (!res.ok) {
        setError(json.error || 'No se pudo guardar a la persona.')
        return
      }
      toast({ variant: 'success' as any, title: editing ? 'Cambios guardados' : 'Persona agregada', description: email })
      await onDone()
      onOpenChange(false)
    } catch {
      setError('No pudimos conectar con el servidor. Intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const roleHelp = INVITE_ROLES.find((r) => r.value === role)?.help

  return (
    <AuroraModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Editar persona' : 'Invitar persona'}
      description={
        editing
          ? 'Cambiá el rol, el estado o la contraseña.'
          : 'Sumá a alguien al equipo con una contraseña temporal. Puede cambiarla después.'
      }
      busy={busy}
      footer={
        <>
          <button type="button" className={auroraBtnSecondary} onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="invite-member-form" className={auroraBtnPrimary} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {editing ? 'Guardar cambios' : 'Invitar'}
          </button>
        </>
      }
    >
      <form id="invite-member-form" onSubmit={submit} className="space-y-4" data-testid="invite-member-form">
        {seatLimit ? (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
            {seatLimit}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}
        <div>
          <label htmlFor="invite-email" className={auroraLabelClass}>
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@ejemplo.com"
            className={auroraInputClass}
            required
            autoFocus
          />
          <p className="mt-1 text-[11px] text-slate-400">Con este email inicia sesión. Si ya tiene cuenta en Betsy, se suma a tu equipo.</p>
        </div>
        <div>
          <label htmlFor="invite-username" className={auroraLabelClass}>
            Nombre de usuario <span className="text-red-500">*</span>
          </label>
          <input
            id="invite-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Ej: PedroPascal02"
            className={auroraInputClass}
            required
          />
          <p className="mt-1 text-[11px] text-slate-400">Identifica quién hace cada venta u orden.</p>
        </div>
        <div>
          <label htmlFor="invite-role" className={auroraLabelClass}>
            Rol <span className="text-red-500">*</span>
          </label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} className={auroraInputClass} required>
            {INVITE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {roleHelp ? <p className="mt-1 text-[11px] text-slate-400">{roleHelp}</p> : null}
        </div>
        <div>
          <label htmlFor="invite-password" className={auroraLabelClass}>
            {editing ? 'Contraseña' : 'Contraseña temporal'} {editing ? null : <span className="text-red-500">*</span>}
          </label>
          <div className="relative">
            <input
              id="invite-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editing ? 'Dejar en blanco para mantener la actual' : 'Mínimo 8 caracteres'}
              className={`${auroraInputClass} pr-10`}
              required={!editing}
              minLength={editing ? undefined : 8}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-0 top-0 flex h-full items-center px-3 text-slate-400 hover:text-slate-700"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">8+ caracteres con mayúscula, minúscula y número.</p>
        </div>
        <label className="flex items-center gap-2.5 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#5B3FE0] focus:ring-[#7C5CFF]"
          />
          Persona activa
        </label>
      </form>
    </AuroraModal>
  )
}
