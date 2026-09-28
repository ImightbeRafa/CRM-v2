import { NextRequest, NextResponse } from 'next/server'
import { staffDisplayName } from '@/lib/display-name'
import { hasPermission, type Role } from '@/lib/rbac'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

/** Only https photo URLs are passed to the client (Google / provider avatars). */
function safeImage(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/**
 * GET /api/chat/assignees — who a chat can be assigned to.
 * Same gate as the inbox (update_sales), unlike GET /api/users (manage_users), so sales
 * agents can pick a teammate. Returns id / name / photo only: no email, no role.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response

  const memberships = await prisma.membership.findMany({
    where: { tenantId: auth.tenantId, isActive: true, user: { active: true } },
    select: { role: true, user: { select: { id: true, name: true, username: true, image: true } } },
    take: 200,
  })

  const assignees = memberships
    // Only people who can open the chats inbox (same rule as the PATCH check).
    .filter((m) => hasPermission(m.role as Role, 'update_sales'))
    .map(({ user }) => ({
      id: user.id,
      name: staffDisplayName(user.name, user.username) || 'Sin nombre',
      image: safeImage(user.image),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return NextResponse.json(
    { success: true, viewerUserId: auth.userId, assignees },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
