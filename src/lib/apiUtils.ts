import { NextResponse } from 'next/server'

export interface ApiResponse<T = any> {
  status: 'success' | 'error'
  data?: T
  error?: string
  message?: string
}

export class ApiError extends Error {
  public statusCode: number
  public isOperational: boolean

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = isOperational
    Error.captureStackTrace(this, this.constructor)
  }
}

export function createSuccessResponse<T>(data: T, message?: string): NextResponse {
  const response: ApiResponse<T> = {
    status: 'success',
    data,
    ...(message && { message })
  }
  return NextResponse.json(response)
}

export function createErrorResponse(
  error: string | Error, 
  statusCode: number = 500,
  message?: string
): NextResponse {
  const errorMessage = error instanceof Error ? error.message : error
  
  const response: ApiResponse = {
    status: 'error',
    error: errorMessage,
    ...(message && { message })
  }
  
  return NextResponse.json(response, { status: statusCode })
}

export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error)
  
  if (error instanceof ApiError) {
    return createErrorResponse(error.message, error.statusCode)
  }
  
  if (error instanceof Error) {
    // Handle Prisma errors
    if (error.message.includes('does not exist') || error.message.includes('no such table')) {
      return createErrorResponse('Database table not found', 404)
    }
    
    if (error.message.includes('Unique constraint')) {
      return createErrorResponse('Duplicate entry', 409)
    }
    
    if (error.message.includes('Foreign key constraint')) {
      return createErrorResponse('Invalid reference', 400)
    }
    
    // Handle specific Prisma error codes
    if (error.message.includes('P2002')) {
      return createErrorResponse('This key already exists. Please choose a different key.', 409)
    }
    
    if (error.message.includes('P2025')) {
      return createErrorResponse('Record not found', 404)
    }
    
    if (error.message.includes('P2003')) {
      return createErrorResponse('Invalid reference to related record', 400)
    }
    
    return createErrorResponse(error.message, 500)
  }
  
  return createErrorResponse('Internal server error', 500)
}

export function validateRequiredFields(data: any, requiredFields: string[]): string | null {
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      return `Field '${field}' is required`
    }
  }
  return null
}

export function validatePassword(password: string): string | null {
  if (!password || password.length < 6) {
    return 'Password must be at least 6 characters long'
  }
  return null
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, '')
}
