import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { createSuccessResponse, createErrorResponse, handleApiError, validatePassword } from '@/lib/apiUtils'
import { requireAdmin } from '@/lib/apiAuth'

// PUT /api/users/[id] - Update user (master only)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (!auth.authorized) {
    return createErrorResponse('Unauthorized', 401)
  }

  try {
    const { username, password, role, active } = await request.json()
    const { id: userId } = await params
    
    const updateData: any = {}
    
    if (username !== undefined) updateData.username = username
    if (role !== undefined) updateData.role = role
    if (active !== undefined) updateData.active = active
    
    if (password && password.length > 0) {
      const passwordError = validatePassword(password)
      if (passwordError) {
        return createErrorResponse(passwordError, 400)
      }
      updateData.password = await bcrypt.hash(password, 12)
    }
    
    // Check if username already exists (if changing username)
    if (username) {
      const existingUser = await prisma.user.findFirst({
        where: { 
          username,
          id: { not: userId }
        }
      })
      
      if (existingUser) {
        return createErrorResponse('El usuario ya existe', 409)
      }
    }
    
    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        updatedAt: true
      }
    })
    
    return createSuccessResponse(user, 'Usuario actualizado exitosamente')
  } catch (error) {
    return handleApiError(error)
  }
}

// DELETE /api/users/[id] - Delete user (master only)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (!auth.authorized) {
    return createErrorResponse('Unauthorized', 401)
  }

  try {
    const { id: userId } = await params
    
    // Don't allow deleting the master user
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })
    
    if (user?.role === 'MASTER') {
      return createErrorResponse('No se puede eliminar el usuario maestro', 400)
    }
    
    await prisma.user.delete({
      where: { id: userId }
    })
    
    return createSuccessResponse(null, 'Usuario eliminado exitosamente')
  } catch (error) {
    return handleApiError(error)
  }
}
