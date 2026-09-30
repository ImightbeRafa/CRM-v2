import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createTeamInvite } from '@/lib/team-invite-service'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'invite_users')
    if (!auth.ok) return auth.response

    const body = await request.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email : ''
    const role = typeof body.role === 'string' ? body.role : 'VIEWER'

    const tenant = await prisma.tenant.findUnique({
      where: { id: auth.tenantId },
      select: { name: true },
    })
    const inviter = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true, username: true, email: true },
    })

    const result = await createTeamInvite({
      tenantId: auth.tenantId,
      email,
      role,
      invitedByUserId: auth.userId,
      tenantName: tenant?.name,
      inviterName: inviter?.name || inviter?.username || inviter?.email || null,
    })

    if (!result.ok) {
      return NextResponse.json({ status: 'error', error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      status: 'success',
      message: result.emailSent
        ? 'Invitación enviada'
        : 'Invitación creada (email no enviado — revisa RESEND_API_KEY)',
      data: {
        inviteId: result.inviteId,
        email: result.email,
        role: result.role,
        emailSent: result.emailSent,
        emailError: result.emailError,
      },
    })
  } catch (error: any) {
    console.error('[invites/create]', error)
    const msg = String(error?.message || '')
    if (msg.includes('TenantInvite') || error?.code === 'P2021') {
      return NextResponse.json(
        {
          status: 'error',
          error:
            'Invitaciones pendientes de migración SQL 030. Usa alta con contraseña o aplica BETSY_V2_APPLY_FILES=030.',
        },
        { status: 503 },
      )
    }
    return NextResponse.json({ status: 'error', error: 'Error creando invitación' }, { status: 500 })
  }
}
