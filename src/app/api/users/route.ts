import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields, validatePassword } from '@/lib/apiUtils'
import { logCreate, logDelete } from '@/lib/auditLogger'

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
    const { email, username, role = 'VIEWER', active = true } = await request.json()
    
    // Validate required fields
    const missingField = validateRequiredFields({ email }, ['email'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })
    
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
      userId = existingUser.id
    } else {
      // Create new user
      const defaultPassword = 'password123' // Default password for new users
      const hashedPassword = await hashPassword(defaultPassword) // Hash password with bcrypt
      
      const newUser = await prisma.user.create({
        data: {
          email,
          username: username || email,
          password: hashedPassword,
          active,
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
      await logCreate(request, 'user', userId, username || email, {
        email,
        username: username || email,
        role: role || 'VIEWER',
        tenantId
      })
    } catch (auditError) {
      console.error('Failed to log user creation audit:', auditError)
    }
    
    return createSuccessResponse(
      { userId, email, role, membershipId: membership.id }, 
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
