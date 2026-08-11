import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword, validatePasswordStrength } from '@/lib/password'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields, validatePassword } from '@/lib/apiUtils'
import { logCreate, logDelete } from '@/lib/auditLogger'
import { checkUserLimit } from '@/lib/plan-enforcement'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

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
            email: true,
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
      email: membership.user.email,
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
    const { email, username, role = 'VIEWER', active = true, password } = await request.json()
    
    // Validate required fields
    const missingField = validateRequiredFields({ email }, ['email'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
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
    let existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    })
    
    // If not found, try original email (in case database has different casing)
    if (!existingUser && email !== normalizedEmail) {
      existingUser = await prisma.user.findUnique({
        where: { email: email.trim() }
      })
    }
    
    let userId: string
    
    if (existingUser) {
      // User exists - check if they already have a membership to this tenant
      const existingMembership = await prisma.membership.findFirst({
        where: {
          userId: existingUser.id,
          tenantId: tenantId
        }
      })
      
      if (existingMembership) {
        return createErrorResponse('El usuario ya pertenece a este tenant', 409)
      }
      
      // Add existing user to this tenant
      console.log(`[User API] Adding existing user ${normalizedEmail} to tenant ${tenantId}`)
      userId = existingUser.id
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
            emailVerified: new Date(), // Set email as verified for API-created users
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
            console.log(`[User API] ⚠️ Race condition detected - using existing user ${normalizedEmail}`)
            userId = raceConditionUser.id
          } else {
            return createErrorResponse('Error: Email ya existe en el sistema', 409)
          }
        } else {
          throw createError // Re-throw other errors
        }
      }
    }
    
    // Create membership for current tenant
    const membership = await prisma.membership.create({
      data: {
        userId: userId,
        tenantId: tenantId,
        role: role as any,
        isActive: true,
        joinedAt: new Date().toISOString()
      }
    })
    
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
    
    // Update membership role only (not the user itself)
    const updatedMembership = await prisma.membership.update({
      where: { id: membership.id },
      data: {
        ...(role && { role: role as any }),
        ...(active !== undefined && { isActive: active })
      }
    })
    
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
    
    // CRITICAL: Remove membership only, NOT the user
    // This allows the user to exist in other tenants
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        isActive: false
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
