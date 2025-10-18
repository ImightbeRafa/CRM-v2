import { z } from 'zod'

// Configuration schema with validation
const configSchema = z.object({
  // Database
  DATABASE_URL: z.string().optional(),
  
  // Authentication
  NEXTAUTH_SECRET: z.string().min(1, 'NEXTAUTH_SECRET is required'),
  NEXTAUTH_URL: z.string().url().optional(),
  
  // External API integration (optional for demo mode)
  NEXT_PUBLIC_SCRIPT_URL: z.string().url().optional(),
  
  // Demo mode settings
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  ALLOWED_EMAILS: z.string().optional(),
  
  // Application settings
  APP_NAME: z.string().default('Betsy CRM'),
  APP_VERSION: z.string().default('1.0.0'),
  
  // Security
  CORS_ORIGINS: z.string().optional(),
  RATE_LIMIT_MAX: z.string().default('100'),
  
  // Backup settings
  BACKUP_RETENTION_DAYS: z.string().default('30'),
  BACKUP_SCHEDULE: z.string().default('0 2 * * *'), // Daily at 2 AM
})

// Parse and validate environment variables
const parseConfig = () => {
  try {
    return configSchema.parse(process.env)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => err.path.join('.')).join(', ')
      throw new Error(`Missing or invalid environment variables: ${missingVars}`)
    }
    throw error
  }
}

// Export validated configuration
export const config = parseConfig()

// Helper functions
export const isDemoMode = () => config.DEMO_MODE === 'true'
export const isProduction = () => process.env.NODE_ENV === 'production'
export const isDevelopment = () => process.env.NODE_ENV === 'development'

// Demo mode configuration
export const getDemoConfig = () => ({
  database: {
    type: 'sqlite',
    url: 'file:./prisma/dev.db'
  },
  auth: {
    providers: ['credentials'],
    session: {
      strategy: 'jwt',
      maxAge: 24 * 60 * 60 // 24 hours
    }
  },
  features: {
    auditLogging: true,
    userManagement: true,
    bulkOperations: true,
    dataExport: true
  }
})

// Production configuration
export const getProductionConfig = () => ({
  database: {
    type: config.DATABASE_URL?.includes('postgres') ? 'postgresql' : 'sqlite',
    url: config.DATABASE_URL || 'file:./prisma/prod.db'
  },
  auth: {
    providers: ['credentials'],
    session: {
      strategy: 'jwt',
      maxAge: 24 * 60 * 60
    }
  },
  features: {
    auditLogging: true,
    userManagement: true,
    bulkOperations: true,
    dataExport: true
  }
})

// Get current configuration based on environment
export const getCurrentConfig = () => {
  if (isDemoMode()) {
    return getDemoConfig()
  }
  return getProductionConfig()
}

// Configuration validation
export const validateConfig = () => {
  try {
    parseConfig()
    return { valid: true, errors: [] }
  } catch (error) {
    return { 
      valid: false, 
      errors: error instanceof Error ? [error.message] : ['Unknown configuration error'] 
    }
  }
}

// Export types
export type Config = z.infer<typeof configSchema>
export type DemoConfig = ReturnType<typeof getDemoConfig>
export type ProductionConfig = ReturnType<typeof getProductionConfig>