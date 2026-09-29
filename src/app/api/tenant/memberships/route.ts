import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPI } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Dueño',
  ADMIN: 'Admin',
  MANAGER: 'Encargado',
  SALES: 'Ventas',
  PRODUCTION: 'Producción',
  VIEWER: 'Lectura',
}

/** GET — MY active businesses (for the sidebar switcher). Names and my role only. */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  const rows = await prisma.membership.findMany({
    where: { userId: auth.userId, isActive: true, user: { active: true }, tenant: { isActive: true } },
    select: { role: true, tenant: { select: { id: true, name: true } } },
    take: 50,
  })
  const businesses = rows
    .map((m) => ({ id: m.tenant.id, name: m.tenant.name || 'Sin nombre', role: ROLE_LABEL[m.role] ?? m.role, current: m.tenant.id === auth.tenantId }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name, 'es'))
  return NextResponse.json({ success: true, businesses }, { headers: { 'Cache-Control': 'no-store' } })
}
