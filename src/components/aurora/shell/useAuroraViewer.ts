'use client'

import { useSession } from 'next-auth/react'
import { getRoleName, hasPermission, type Permission, type Role } from '@/lib/rbac'

const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'SALES', 'PRODUCTION', 'VIEWER']

export type AuroraViewer = {
  name: string
  email: string
  tenantName: string
  /** Real membership role (`null` while the session loads). */
  role: Role | null
  isMaster: boolean
  /** Owner / admin / master: pages behind `view_config`. */
  isAdmin: boolean
  roleLabel: string
  can: (permission: Permission) => boolean
}

/** Session-derived facts shared by the Aurora shell menus (bell, profile, tenant block, ⌘K). */
export function useAuroraViewer(): AuroraViewer {
  const { data: session } = useSession()
  const user = session?.user
  const rawRole = user?.currentTenant?.role
  const role = ROLES.includes(rawRole as Role) ? (rawRole as Role) : null
  const isMaster = user?.role === 'MASTER'
  const isAdmin = isMaster || role === 'OWNER' || role === 'ADMIN'
  const roleLabel = isMaster ? 'Master' : role ? getRoleName(role) : ''
  return {
    name: user?.name?.trim() || user?.email?.split('@')[0] || 'Usuario',
    email: user?.email || '',
    tenantName: user?.currentTenant?.name?.trim() || 'Mi espacio',
    role,
    isMaster,
    isAdmin,
    roleLabel,
    can: (permission) => isMaster || (role ? hasPermission(role, permission) : false),
  }
}
