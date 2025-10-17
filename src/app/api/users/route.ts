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
    const { username, password, role = 'REGULAR' } = await request.json()
    
    // Validate required fields
    const missingField = validateRequiredFields({ username, password }, ['username', 'password'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    // Validate password
    const passwordError = validatePassword(password)
    if (passwordError) {
      return createErrorResponse(passwordError, 400)
    }
    
    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username }
    })
    
    if (existingUser) {
      return createErrorResponse('El usuario ya existe', 409)
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)
    
    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: role as 'MASTER' | 'REGULAR'
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
