'use client'

import { Plus, Users } from 'lucide-react'
import { AuroraEmptyState, auroraButtonPrimary } from '../../states/AuroraEmptyState'
import { AuroraListSkeleton } from '../../states/AuroraSkeleton'
import { ConfigCard } from './ConfigCard'
import { ConfigPanelHeader } from './ConfigPanelHeader'

export type UsersPanelUser = {
  id: string
  username: string
  email?: string | null
  role: string
  active: boolean
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MASTER: 'Master',
  MANAGER: 'Gerente',
  SALES: 'Ventas',
  PRODUCTION: 'Producción',
  VIEWER: 'Visualizador',
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '·'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Equipo panel (`/config?tab=users`): members with role + status, add / edit / delete. */
export function UsersPanel({
  users,
  loading,
  onAdd,
  onEdit,
  onDelete,
}: {
  users: UsersPanelUser[]
  loading: boolean
  onAdd: () => void
  onEdit: (user: UsersPanelUser) => void
  onDelete: (id: string) => void
}) {
  const addButton = (
    <button type="button" onClick={onAdd} className="inline-flex items-center gap-2 rounded-[10px] bg-[#5B3FE0] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#4A32C4]">
      <Plus className="h-4 w-4" aria-hidden />
      Agregar persona
    </button>
  )

  return (
    <div data-testid="config-users-panel">
      <ConfigPanelHeader
        title="Equipo"
        subtitle="Quién entra a Betsy y qué puede hacer"
        actions={users.length > 0 ? addButton : undefined}
      />

      {loading ? (
        <ConfigCard>
          <AuroraListSkeleton rows={3} label="Cargando equipo" />
        </ConfigCard>
      ) : users.length === 0 ? (
        <ConfigCard>
          <AuroraEmptyState
            icon={<Users className="h-6 w-6" />}
            title="Todavía no hay personas en el equipo"
            description="Agregá a quien va a atender chats o gestionar pedidos."
            actions={
              <button type="button" onClick={onAdd} className={auroraButtonPrimary}>
                Agregar persona
              </button>
            }
          />
        </ConfigCard>
      ) : (
        <>
          <ConfigCard className="overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_140px_110px_150px] gap-4 border-b border-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
              <span>Persona</span>
              <span>Rol</span>
              <span>Estado</span>
              <span className="text-right">Acciones</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {users.map((user) => (
                <li
                  key={user.id}
                  data-testid="config-user-row"
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1fr)_140px_110px_150px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-[12px] font-bold text-white">
                      {initials(user.username)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-slate-900">{user.username}</p>
                      {user.email ? <p className="truncate text-[12px] text-slate-500">{user.email}</p> : null}
                    </div>
                  </div>
                  <span className="justify-self-end md:justify-self-start">
                    <span className="inline-flex rounded-full bg-[#F1EEFF] px-2.5 py-1 text-[12px] font-medium text-[#5B3FE0]">
                      {ROLE_LABEL[user.role] ?? user.role}
                    </span>
                  </span>
                  <span>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium ${
                        user.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {user.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(user)}
                      className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#5B3FE0] hover:bg-[#F1EEFF]"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(user.id)}
                      className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-red-600 hover:bg-red-50"
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </ConfigCard>

          {users.length === 1 && (
            <ConfigCard className="mt-4">
              <AuroraEmptyState
                tone="neutral"
                icon={<Users className="h-6 w-6" />}
                title="Por ahora solo estás vos"
                description="Sumá a tu equipo para repartir chats y pedidos."
                actions={
                  <button type="button" onClick={onAdd} className={auroraButtonPrimary}>
                    Agregar persona
                  </button>
                }
              />
            </ConfigCard>
          )}
        </>
      )}
    </div>
  )
}
