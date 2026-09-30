import { NextRequest, NextResponse } from 'next/server'
import { findUserIdByEmail } from '@/lib/user-lookup'
import { prisma } from '@/lib/db'
import { hashPassword, validatePasswordStrength } from '@/lib/password'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields, validatePassword } from '@/lib/apiUtils'
import { logCreate, logDelete } from '@/lib/auditLogger'
import { checkUserLimit } from '@/lib/plan-enforcement'
import { getTenantSeatUsageWithClient } from '@/lib/plan-enforcement'
import { inviteMembershipAction, resolveDefaultTenantAfterRemoval } from '@/lib/membership-lifecycle'
import { createTeamInvite } from '@/lib/team-invite-service'
import { Prisma } from '@prisma/client'
import { checkMemberChange, MEMBER_ROLES } from '@/lib/member-admin-guard'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

async function lockAndReadSeatUsage(tx: Prisma.TransactionClient, tenantId: string) {
  // Shared with bot-session admission so a member and bot cannot both claim
  // the tenant's final seat concurrently.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-seat:${tenantId}`}))`
  return getTenantSeatUsageWithClient(tx, tenantId)
}

function seatLimitResponse(usage: Awaited<ReturnType<typeof getTenantSeatUsageWithClient>>) {
  return NextResponse.json({
    status: 'error',
    error: `Límite de usuarios alcanzado (${usage.currentCount}/${usage.limit}). Actualiza tu plan para agregar más usuarios.`,
    needsUpgrade: true,
    currentPlan: usage.plan,
    currentCount: usage.currentCount,
    limit: usage.limit,
  }, { status: 402 })
}

// GET /api/users - List users belonging to current tenant only
export async function GET(request: NextRequest) {
  try {
    // Require 'manage_users' permission
    const auth = await authenticateAPIWithPermission(request, 'manage_users')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    
    // Get only users that have a membership to the current tenant
    const memberships = await prisma.membership.findMany({
      where: {
        tenantId: tenantId,
        isActive: true
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            image: true,
            active: true,
            createdAt: true,
            updatedAt: true
          }
        }
      },
      orderBy: {
        user: { createdAt: 'desc' }
      }
    })
    
    // Map to user format with role from membership
    const usersWithRoles = memberships.map(membership => ({
      id: membership.user.id,
      username: membership.user.username || membership.user.email,
      name: membership.user.name,
      email: membership.user.email,
      image: membership.user.image,
      role: membership.role,
      active: membership.user.active,
      createdAt: membership.user.createdAt,
      updatedAt: membership.user.updatedAt,
      membershipId: membership.id // Include membership ID for deletion
    }))
    
    return createSuccessResponse(usersWithRoles)
  } catch (error) {
    return handleApiError(error)
  }
}

// POST /api/users - Create new user and add to current tenant
export async function POST(request: NextRequest) {
  try {
    // Require 'invite_users' permission
    const auth = await authenticateAPIWithPermission(request, 'invite_users')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const body = await request.json()
    const { email, username, role = 'VIEWER', active = true, password, invite = false } = body
    
    // Validate required fields
    const missingField = validateRequiredFields({ email }, ['email'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }

    // Role hierarchy (AUTH-23): valid roles only; only an Owner adds another Owner.
    if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
      return createErrorResponse('Rol inválido', 400)
    }
    if (role === 'OWNER') {
      // The actor's CURRENT role from the DB, not the session's (AUTH-28).
      const actor = await prisma.membership.findFirst({
        where: { userId: auth.userId, tenantId, isActive: true },
        select: { role: true },
      })
      if (actor?.role !== 'OWNER') {
        return createErrorResponse('Solo un Owner puede asignar el rol Owner.', 403)
      }
    }

    // Email invite (join only on accept). Used for invite mode AND for any EXISTING account: an
    // account is never attached to another business without its owner accepting (SecureDog N1 —
    // with the business switcher such a membership would show up one click away).
    const sendInvite = async () => {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      const inviter = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { name: true, username: true, email: true },
      })
      const result = await createTeamInvite({
        tenantId,
        email,
        role,
        invitedByUserId: auth.userId,
        tenantName: tenant?.name,
        inviterName: inviter?.name || inviter?.username || inviter?.email || null,
      })
      if (!result.ok) return createErrorResponse(result.error, result.status)
      return createSuccessResponse(
        {
          inviteId: result.inviteId,
          email: result.email,
          role: result.role,
          emailSent: result.emailSent,
          invite: true,
        },
        result.emailSent ? 'Invitación enviada' : 'Invitación creada (email pendiente de RESEND)',
      )
    }
    if (invite === true || body.inviteMode === true) return sendInvite()
    
    // Validate password is provided for new users
    if (!password || password.trim().length === 0) {
      return createErrorResponse('Password is required when creating a new user', 400)
    }
    
    // Validate password strength (same policy as self-registration / reset)
    const passwordCheck = validatePasswordStrength(password)
    if (!passwordCheck.valid) {
      return createErrorResponse(passwordCheck.errors.join('. '), 400)
    }
    
    // Normalize email (trim and lowercase) for consistency
    const normalizedEmail = email.trim().toLowerCase()
    
    // Check plan user limit (soft enforcement)
    const limitCheck = await checkUserLimit(tenantId)
    if (!limitCheck.allowed) {
      return NextResponse.json({
        status: 'error',
        error: limitCheck.message,
        needsUpgrade: true,
        currentPlan: limitCheck.currentPlan,
        currentCount: limitCheck.currentCount,
        limit: limitCheck.limit
      }, { status: 402 }) // 402 Payment Required
    }

    // CRITICAL: Check if user already exists with this email (normalized)
    // This prevents duplicate users across different tenants
    // Case-insensitive exact lookup (legacy mixed-case accounts included), same as invites.
    const existingUserId = await findUserIdByEmail(normalizedEmail)
    const existingUser = existingUserId ? await prisma.user.findUnique({ where: { id: existingUserId } }) : null
    
    let userId: string
    
    if (existingUser) {
      // User exists - check if they already have a membership to this tenant
      const existingMembership = await prisma.membership.findFirst({
        where: {
          userId: existingUser.id,
          tenantId: tenantId
        }
      })

      const membershipAction = inviteMembershipAction(existingMembership)
      if (membershipAction === 'conflict') {
        return createErrorResponse('El usuario ya pertenece a este tenant', 409)
      }
      // Existing account (new or former member): they join by accepting an emailed invite (N1).
      return sendInvite()
    } else {
      // Create new user with provided password
      console.log(`[User API] Creating new user ${normalizedEmail}`)
      const hashedPassword = await hashPassword(password.trim()) // Hash password with bcrypt
      
      try {
        const newUser = await prisma.user.create({
          data: {
            email: normalizedEmail, // Use normalized email (MUST be unique globally)
            username: username || normalizedEmail,
            password: hashedPassword,
            active: active !== false, // Default to true if not explicitly set to false
            // Not verified: only the mailbox owner can prove it (verification link, reset or Google).
            // An admin-chosen password on a "verified" account let the admin keep the account
            // after the real owner later linked Google (AUTH-08).
            emailVerified: null,
            defaultTenantId: tenantId
          },
          select: {
            id: true,
            username: true,
            email: true,
            active: true,
            createdAt: true
          }
        })
        userId = newUser.id
      } catch (createError: any) {
        // Handle unique constraint violation (P2002)
        if (createError.code === 'P2002') {
          console.error(`[User API] ❌ Unique constraint violation for email: ${normalizedEmail}`)
          // Email already exists - this shouldn't happen since we checked above
          // But if it does (race condition), try to find the user and add to tenant
          const raceConditionUser = await prisma.user.findUnique({
            where: { email: normalizedEmail }
          })
          if (raceConditionUser) {
            // Someone registered this email meanwhile: same rule, an invite they must accept.
            return sendInvite()
          } else {
            return createErrorResponse('Error: Email ya existe en el sistema', 409)
          }
        } else {
          throw createError // Re-throw other errors
        }
      }
    }
    
    // Create membership for current tenant
    const admission = await prisma.$transaction(async tx => {
      const usage = await lockAndReadSeatUsage(tx, tenantId)
      if (usage.currentCount >= usage.limit) return { usage, membership: null }
      const membership = await tx.membership.create({
        data: {
          userId: userId,
          tenantId: tenantId,
          role: role as any,
          isActive: true,
          joinedAt: new Date().toISOString()
        }
      })
      return { usage, membership }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (!admission.membership) return seatLimitResponse(admission.usage)
    const membership = admission.membership
    
    // Log audit trail
    try {
      await logCreate(request, 'user', userId, username || normalizedEmail, {
        email: normalizedEmail,
        username: username || normalizedEmail,
        role: role || 'VIEWER',
        tenantId
      })
    } catch (auditError) {
      console.error('Failed to log user creation audit:', auditError)
    }
    
    return createSuccessResponse(
      { userId, email: normalizedEmail, role, membershipId: membership.id }, 
      existingUser ? 'Usuario agregado al tenant' : 'Usuario creado exitosamente'
    )
  } catch (error) {
    return handleApiError(error)
  }
}

// PUT /api/users - Update user role in current tenant
export async function PUT(request: NextRequest) {
  try {
    // Require 'manage_users' permission
    const auth = await authenticateAPIWithPermission(request, 'manage_users')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const { id, username, email, role, active } = await request.json()
    if (active !== undefined && typeof active !== 'boolean') {
      return createErrorResponse('active debe ser true o false', 400)
    }
    
    if (!id) {
      return createErrorResponse('ID de usuario requerido', 400)
    }
    
    // Find the membership for this user in the current tenant
    const membership = await prisma.membership.findFirst({
      where: {
        userId: id,
        tenantId: tenantId
      },
      include: {
        user: true
      }
    })
    
    if (!membership) {
      return createErrorResponse('Usuario no encontrado en este tenant', 404)
    }

    // A removed member comes back only by accepting an invite (SecureDog N1 remainder): never
    // re-attached directly, or the business would reappear in their switcher without consent.
    if (active === true && !membership.isActive) {
      return createErrorResponse('Esta persona ya no es miembro: enviale una invitación para que vuelva.', 409)
    }
    // Role hierarchy + last-owner guard (AUTH-23).
    const guard = await guardMemberChange(auth, membership, { newRole: role ?? null, remove: active === false, reactivate: active === true })
    if (!guard.ok) return createErrorResponse(guard.error, guard.status)

    // Reactivation consumes a seat. Use the same transaction-scoped advisory
    // lock as POST membership admission and bot-session admission so two
    // channels cannot claim the tenant's last seat concurrently.
    let updatedMembership
    if (active === true && !membership.isActive) {
      const admission = await prisma.$transaction(async tx => {
        const usage = await lockAndReadSeatUsage(tx, tenantId)
        if (usage.currentCount >= usage.limit) return { usage, membership: null }
        const reactivated = await tx.membership.update({
          where: { id: membership.id },
          data: {
            ...(role && { role: role as any }),
            isActive: true,
          },
        })
        return { usage, membership: reactivated }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      if (!admission.membership) return seatLimitResponse(admission.usage)
      updatedMembership = admission.membership
    } else {
      // Role-only updates, deactivation, and no-op active updates do not admit
      // a new seat and therefore do not need the admission lock.
      updatedMembership = await prisma.membership.update({
        where: { id: membership.id },
        data: {
          ...(role && { role: role as any }),
          ...(active !== undefined && { isActive: active })
        }
      })
    }
    
    return createSuccessResponse(
      { 
        id: membership.user.id,
        username: membership.user.username || membership.user.email,
        email: membership.user.email,
        role: updatedMembership.role,
        active: updatedMembership.isActive
      }, 
      'Usuario actualizado exitosamente'
    )
  } catch (error) {
    return handleApiError(error)
  }
}

// DELETE /api/users - Remove user from current tenant (deactivate membership)
export async function DELETE(request: NextRequest) {
  try {
    // Require 'manage_users' permission
    const auth = await authenticateAPIWithPermission(request, 'manage_users')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return createErrorResponse('ID de usuario requerido', 400)
    }
    
    // Find the membership for this user in the current tenant
    const membership = await prisma.membership.findFirst({
      where: {
        userId: id,
        tenantId: tenantId
      },
      include: {
        user: {
          select: {
            email: true,
            username: true
          }
        }
      }
    })
    
    if (!membership) {
      return createErrorResponse('Usuario no encontrado en este tenant', 404)
    }

    const guard = await guardMemberChange(auth, membership, { remove: true })
    if (!guard.ok) return createErrorResponse(guard.error, guard.status)

    // Remove membership only, NOT the user. Sign-in must not revive this row.
    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          isActive: false
        }
      })

      const [targetUser, remaining] = await Promise.all([
        tx.user.findUnique({
          where: { id },
          select: { defaultTenantId: true }
        }),
        tx.membership.findMany({
          where: { userId: id, isActive: true },
          select: { tenantId: true },
          orderBy: { joinedAt: 'desc' }
        })
      ])

      const nextDefault = resolveDefaultTenantAfterRemoval(
        targetUser?.defaultTenantId,
        tenantId,
        remaining.map((row) => row.tenantId)
      )

      if (targetUser && targetUser.defaultTenantId !== nextDefault) {
        await tx.user.update({
          where: { id },
          data: { defaultTenantId: nextDefault }
        })
      }
    })
    
    // Log audit trail
    try {
      await logDelete(request, 'user', id, membership.user.username || membership.user.email, {
        email: membership.user.email,
        username: membership.user.username,
        tenantId
      }, 'Usuario removido del tenant')
    } catch (auditError) {
      console.error('Failed to log user deletion audit:', auditError)
    }
    
    return createSuccessResponse(
      null, 
      `Usuario ${membership.user.username || membership.user.email} removido de este tenant`
    )
  } catch (error) {
    return handleApiError(error)
  }
}

async function guardMemberChange(
  auth: { userId: string; role: string; tenantId: string },
  target: { userId: string; role: string; isActive: boolean },
  change: { newRole?: string | null; remove?: boolean; reactivate?: boolean },
) {
  const [activeOwnerCount, actor] = await Promise.all([
    prisma.membership.count({ where: { tenantId: auth.tenantId, role: 'OWNER', isActive: true } }),
    // The actor's CURRENT role, not the session's (a just-demoted Owner, AUTH-28).
    prisma.membership.findFirst({
      where: { userId: auth.userId, tenantId: auth.tenantId, isActive: true },
      select: { role: true },
    }),
  ])
  return checkMemberChange({
    actorUserId: auth.userId,
    actorRole: actor?.role ?? 'NONE',
    targetUserId: target.userId,
    targetRole: target.role,
    targetActive: target.isActive,
    newRole: change.newRole,
    remove: change.remove,
    reactivate: change.reactivate,
    activeOwnerCount,
  })
}
