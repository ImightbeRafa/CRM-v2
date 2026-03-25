import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    
    // If authentication failed due to missing tenant, return default settings
    // This allows the app to work before tenant setup is complete
    if (!auth.ok) {
      const response = auth.response
      // Check if it's a 400 "Tenant not found" error by checking status
      // NextResponse extends Response, so it has a status property
      const statusCode = (response as any).status || (response as Response).status
      if (statusCode === 400) {
        // Return default settings when tenant is not found
        return NextResponse.json({ 
          status: 'success', 
          data: { currency: 'CRC', currencySymbol: '₡', locale: 'es-CR', language: 'es' }
        })
      }
      // For other auth errors (401, 403), return the error response
      return response
    }
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    // Get tenant settings
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true }
    })
    
    return NextResponse.json({ 
      status: 'success', 
      data: tenant?.settings || { currency: 'CRC', currencySymbol: '₡', locale: 'es-CR', language: 'es' }
    })
  } catch (error) {
    console.error('Error loading settings:', error)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Failed to load settings' 
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    
    // Get current settings
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true }
    })
    
    // Merge new settings with existing ones
    const currentSettings = (tenant?.settings as any) || {}
    const updatedSettings = {
      ...currentSettings,
      currency: body.currency,
      currencySymbol: body.currencySymbol,
      language: body.language,
      locale: body.locale || `${body.language}-CR`,
      updatedAt: new Date().toISOString()
    }
    
    console.log('💾 Saving settings for tenant:', tenantId);
    
    // Update tenant settings
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: updatedSettings }
    })
    
    return NextResponse.json({ 
      status: 'success', 
      data: updatedSettings,
      message: 'Settings saved successfully' 
    })
  } catch (error) {
    console.error('Error saving settings:', error)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Failed to save settings' 
    }, { status: 500 })
  }
}

