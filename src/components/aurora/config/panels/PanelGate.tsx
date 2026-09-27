'use client'

import type { ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import type { Permission } from '@/lib/rbac'
import { hasSessionPermission } from '@/lib/session-permissions'
import { AuroraEmptyState } from '../../states/AuroraEmptyState'
import { AuroraListSkeleton } from '../../states/AuroraSkeleton'

/**
 * Client-side permission gate for a Config panel. Server enforcement stays in the APIs and
 * layouts; this stops panels that redirect on their own (e.g. Cuentas conectadas) from
 * ejecting a user who opens `?tab=` without the permission.
 */
export function PanelGate({
  permission,
  label,
  children,
}: {
  permission: Permission
  label: string
  children: ReactNode
}) {
  const { data: session, status } = useSession()
  if (status === 'loading') return <AuroraListSkeleton rows={4} label={`Cargando ${label}`} />
  if (!hasSessionPermission(session, permission)) {
    return (
      <AuroraEmptyState
        tone="neutral"
        icon="🔒"
        title="Sin permiso"
        description={`Pedile a un administrador acceso a ${label}.`}
      />
    )
  }
  return <>{children}</>
}
