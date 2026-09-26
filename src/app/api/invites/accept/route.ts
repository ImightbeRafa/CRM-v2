import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'
import { acceptTeamInviteForUser, findAcceptableInviteByToken } from '@/lib/team-invite-service'
import { TEAM_INVITE_COOKIE } from '@/lib/team-invite'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || ''
  const invite = token ? await findAcceptableInviteByToken(token) : null
  if (!invite) {
    return NextResponse.json({ status: 'error', error: 'Invitación no válida o expirada' }, { status: 404 })
  }
  return NextResponse.json({
    status: 'success',
    data: {
      email: invite.email,
      role: invite.role,
      tenantName: invite.tenant.name,
      expiresAt: invite.expiresAt,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ status: 'error', error: 'Debes iniciar sesión' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const token =
      (typeof body.token === 'string' && body.token) ||
      request.cookies.get(TEAM_INVITE_COOKIE)?.value ||
      ''

    const result = await acceptTeamInviteForUser({
      token,
      userId: session.user.id,
      userEmail: session.user.email,
    })

    if (!result.ok) {
      return NextResponse.json({ status: 'error', error: result.error }, { status: result.status })
    }

    const response = NextResponse.json({
      status: 'success',
      message: `Te uniste a ${result.tenantName}`,
      data: { tenantId: result.tenantId, role: result.role },
    })
    response.cookies.set(TEAM_INVITE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return response
  } catch (error: any) {
    console.error('[invites/accept]', error)
    const msg = String(error?.message || '')
    if (msg.includes('TenantInvite') || error?.code === 'P2021') {
      return NextResponse.json(
        { status: 'error', error: 'Invitaciones pendientes de migración SQL 030.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ status: 'error', error: 'Error aceptando invitación' }, { status: 500 })
  }
}
