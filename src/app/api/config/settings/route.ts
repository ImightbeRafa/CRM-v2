import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    // Get tenant settings
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true }
    })
    
    return NextResponse.json({ 
      status: 'success', 
      data: tenant?.settings || { currency: 'CRC', currencySymbol: '₡', locale: 'es-CR' }
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
    
    console.log('💾 Saving settings to DB:', updatedSettings);
    
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

