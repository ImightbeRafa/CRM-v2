import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { inviteMembershipAction } from '@/lib/membership-lifecycle'
import {
  generateInviteToken,
  inviteExpiresAt,
  inviteEmailsMatch,
  isAllowedInviteRole,
  isInviteAcceptable,
  normalizeInviteEmail,
  type TeamInviteRole,
} from '@/lib/team-invite'
import { sendTeamInviteEmail } from '@/lib/email'

export type CreateTeamInviteInput = {
  tenantId: string
  email: string
  role: string
  invitedByUserId: string
  tenantName?: string | null
  inviterName?: string | null
}

export async function createTeamInvite(input: CreateTeamInviteInput) {
  const email = normalizeInviteEmail(input.email)
  if (!email || !email.includes('@')) {
    return { ok: false as const, error: 'Email inválido', status: 400 }
  }
  if (!isAllowedInviteRole(input.role)) {
    return { ok: false as const, error: 'Rol de invitación inválido', status: 400 }
  }
  const role = input.role as TeamInviteRole

  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: {
      id: true,
      memberships: {
        where: { tenantId: input.tenantId, isActive: true },
        select: { id: true },
        take: 1,
      },
    },
  })
  if (existingUser?.memberships.length) {
    return { ok: false as const, error: 'El usuario ya pertenece a este tenant', status: 409 }
  }

  // Revoke prior pending invites for same tenant+email
  await (prisma as any).tenantInvite.updateMany({
    where: {
      tenantId: input.tenantId,
      email,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  })

  const token = generateInviteToken()
  const invite = await (prisma as any).tenantInvite.create({
    data: {
      tenantId: input.tenantId,
      email,
      role,
      token,
      invitedByUserId: input.invitedByUserId,
      expiresAt: inviteExpiresAt(),
    },
  })

  const emailResult = await sendTeamInviteEmail({
    email,
    token,
    tenantName: input.tenantName || 'tu equipo en Betsy',
    inviterName: input.inviterName || null,
    role,
  })

  return {
    ok: true as const,
    inviteId: invite.id as string,
    email,
    role,
    emailSent: emailResult.success,
    emailError: emailResult.error || null,
  }
}

export async function findAcceptableInviteByToken(token: string) {
  if (!token || token.length < 16) return null
  const invite = await (prisma as any).tenantInvite.findUnique({
    where: { token },
    include: {
      tenant: { select: { id: true, name: true, slug: true, isActive: true } },
    },
  })
  if (!invite) return null
  const gate = isInviteAcceptable(invite)
  if (!gate.ok) return null
  if (!invite.tenant?.isActive) return null
  return invite as {
    id: string
    tenantId: string
    email: string
    role: TeamInviteRole
    token: string
    invitedByUserId: string
    expiresAt: Date
    tenant: { id: string; name: string; slug: string; isActive: boolean }
  }
}

export async function findPendingInviteForEmail(email: string) {
  const normalized = normalizeInviteEmail(email)
  const invites = await (prisma as any).tenantInvite.findMany({
    where: {
      email: normalized,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: {
      tenant: { select: { id: true, name: true, slug: true, isActive: true } },
    },
  })
  const invite = invites[0]
  if (!invite?.tenant?.isActive) return null
  return invite as {
    id: string
    tenantId: string
    email: string
    role: TeamInviteRole
    token: string
    invitedByUserId: string
    tenant: { id: string; name: string; slug: string; isActive: boolean }
  }
}

/**
 * Join inviting tenant for an authenticated user. Never creates a new tenant.
 */
export async function acceptTeamInviteForUser(input: {
  token?: string | null
  inviteId?: string | null
  userId: string
  userEmail: string
}) {
  let invite =
    input.token ? await findAcceptableInviteByToken(input.token) : null
  if (!invite && input.inviteId) {
    const row = await (prisma as any).tenantInvite.findUnique({
      where: { id: input.inviteId },
      include: {
        tenant: { select: { id: true, name: true, slug: true, isActive: true } },
      },
    })
    if (row && isInviteAcceptable(row).ok && row.tenant?.isActive) {
      invite = row
    }
  }
  if (!invite) {
    return { ok: false as const, error: 'Invitación no válida o expirada', status: 404 }
  }
  if (!inviteEmailsMatch(invite.email, input.userEmail)) {
    return {
      ok: false as const,
      error: 'Esta invitación es para otro correo. Inicia sesión con el email invitado.',
      status: 403,
    }
  }

  const existingMembership = await prisma.membership.findFirst({
    where: { userId: input.userId, tenantId: invite.tenantId },
  })
  const action = inviteMembershipAction(existingMembership)

  await prisma.$transaction(async (tx) => {
    if (action === 'conflict' && existingMembership) {
      // Already a member — still mark invite accepted
    } else if (action === 'reactivate' && existingMembership) {
      await tx.membership.update({
        where: { id: existingMembership.id },
        data: {
          isActive: true,
          role: invite!.role as any,
          invitedBy: invite!.invitedByUserId,
          invitedAt: new Date(),
          joinedAt: new Date(),
        },
      })
    } else {
      await tx.membership.create({
        data: {
          userId: input.userId,
          tenantId: invite!.tenantId,
          role: invite!.role as any,
          isActive: true,
          invitedBy: invite!.invitedByUserId,
          invitedAt: new Date(),
          joinedAt: new Date(),
        },
      })
    }

    await (tx as any).tenantInvite.update({
      where: { id: invite!.id },
      data: {
        acceptedAt: new Date(),
        acceptedUserId: input.userId,
      },
    })

    await tx.user.update({
      where: { id: input.userId },
      data: {
        active: true,
        defaultTenantId: invite!.tenantId,
        emailVerified: new Date(),
      },
    })
  })

  return {
    ok: true as const,
    tenantId: invite.tenantId,
    role: invite.role,
    tenantName: invite.tenant.name,
  }
}
