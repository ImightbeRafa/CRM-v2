import { z } from 'zod'

// Common validation schemas
export const emailSchema = z.string().email('Invalid email format')
export const phoneSchema = z.string().regex(/^[\+]?[1-9][\d]{0,15}$/, 'Invalid phone number format')
export const passwordSchema = z.string().min(6, 'Password must be at least 6 characters')
export const usernameSchema = z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username too long')
export const nameSchema = z.string().min(1, 'Name is required').max(100, 'Name too long')

// Order validation schemas
export const orderSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  orderType: z.enum(['EA', 'RA']),
  status: z.string().min(1, 'Status is required'),
  customerName: z.string().min(1, 'Customer name is required'),
  phone: z.string().optional(),
  email: emailSchema.optional().or(z.literal('')),
  business: z.string().optional(),
  product: z.string().optional(),
  quantity: z.number().int().min(0, 'Quantity must be non-negative'),
  total: z.number().min(0, 'Total must be non-negative'),
  seller: z.string().optional(),
  province: z.string().optional(),
  canton: z.string().optional(),
  district: z.string().optional(),
  address: z.string().optional(),
})

// User validation schemas
export const userCreateSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['MASTER', 'REGULAR']).default('REGULAR')
})

export const userUpdateSchema = z.object({
  username: usernameSchema.optional(),
  password: passwordSchema.optional(),
  role: z.enum(['MASTER', 'REGULAR']).optional(),
  active: z.boolean().optional()
})

// Product field validation
export const productFieldSchema = z.object({
  key: z.string().min(1, 'Key is required').regex(/^[a-zA-Z0-9_]+$/, 'Key must contain only letters, numbers, and underscores'),
  label: z.string().min(1, 'Label is required'),
  type: z.enum(['text', 'number', 'select', 'multiselect', 'boolean']),
  required: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
  optionSetId: z.string().optional(),
  multiSelect: z.boolean().default(false)
})

// Option set validation
export const optionSetSchema = z.object({
  key: z.string().min(1, 'Key is required').regex(/^[a-zA-Z0-9_]+$/, 'Key must contain only letters, numbers, and underscores'),
  name: z.string().min(1, 'Name is required')
})

// Option validation
export const optionSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  value: z.string().min(1, 'Value is required'),
  priceDelta: z.number().default(0)
})

// Shipping method validation
export const shippingMethodSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  carrier: z.string().optional(),
  basePrice: z.number().min(0, 'Base price must be non-negative')
})

// Seller validation
export const sellerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long')
})

// Validation helper functions
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: string[] } {
  try {
    const result = schema.parse(data)
    return { success: true, data: result }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        errors: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
      }
    }
    return {
      success: false,
      errors: ['Validation failed']
    }
  }
}

// Sanitization functions
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
}

export function sanitizeNumber(input: string | number): number {
  const num = typeof input === 'string' ? parseFloat(input) : input
  return isNaN(num) ? 0 : Math.max(0, num) // Ensure non-negative
}

export function sanitizeEmail(email: string): string {
  return sanitizeString(email).toLowerCase()
}

// XSS protection
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// SQL injection protection (basic)
export function sanitizeForSql(input: string): string {
  return input
    .replace(/[';]/g, '') // Remove single quotes and semicolons
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove block comment starts
    .replace(/\*\//g, '') // Remove block comment ends
}
