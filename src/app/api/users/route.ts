import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields, validatePassword } from '@/lib/apiUtils'

// GET /api/users - List all users (master only)
export async function GET(request: NextRequest) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    })
    
    return createSuccessResponse(users)
  } catch (error) {
    return handleApiError(error)
  }
}

// POST /api/users - Create new user (master only)
export async function POST(request: NextRequest) {
  try {
    const { username, role = 'REGULAR', active = true } = await request.json()
    
    // Validate required fields
    const missingField = validateRequiredFields({ username }, ['username'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username }
    })
    
    if (existingUser) {
      return createErrorResponse('El usuario ya existe', 409)
    }
    
    // Create user with default password
    const defaultPassword = 'password123' // Default password for new users
    const hashedPassword = await bcrypt.hash(defaultPassword, 12)
    
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: role as 'MASTER' | 'REGULAR',
        active
      },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true
      }
    })
    
    return createSuccessResponse(user, 'Usuario creado exitosamente')
  } catch (error) {
    return handleApiError(error)
  }
}

// PUT /api/users - Update user (master only)
export async function PUT(request: NextRequest) {
  try {
    const { id, username, role, active } = await request.json()
    
    if (!id) {
      return createErrorResponse('ID de usuario requerido', 400)
    }
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id }
    })
    
    if (!existingUser) {
      return createErrorResponse('Usuario no encontrado', 404)
    }
    
    // Check if username is being changed and if it already exists
    if (username && username !== existingUser.username) {
      const usernameExists = await prisma.user.findUnique({
        where: { username }
      })
      
      if (usernameExists) {
        return createErrorResponse('El nombre de usuario ya existe', 409)
      }
    }
    
    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(username && { username }),
        ...(role && { role: role as 'MASTER' | 'REGULAR' }),
        ...(active !== undefined && { active })
      },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        updatedAt: true
      }
    })
    
    return createSuccessResponse(updatedUser, 'Usuario actualizado exitosamente')
  } catch (error) {
    return handleApiError(error)
  }
}

// DELETE /api/users - Delete user (master only)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return createErrorResponse('ID de usuario requerido', 400)
    }
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id }
    })
    
    if (!existingUser) {
      return createErrorResponse('Usuario no encontrado', 404)
    }
    
    // Delete user
    await prisma.user.delete({
      where: { id }
    })
    
    return createSuccessResponse(null, 'Usuario eliminado exitosamente')
  } catch (error) {
    return handleApiError(error)
  }
}
