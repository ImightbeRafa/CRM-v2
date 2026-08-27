import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

/**
 * POST /api/setup/wizard-complete
 * Marks the profile as completed for the current tenant
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    const { tenantId } = auth;

    // Update tenant to mark profile as completed
    // @ts-ignore - profileCompleted exists in schema, regenerate Prisma client if TypeScript complains
    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { profileCompleted: true } as any,
      select: { id: true, profileCompleted: true } as any
    });

    console.log(`✅ Profile marked as completed for tenant ${tenantId}`);

    return NextResponse.json({ 
      success: true,
      message: 'Profile marked as completed',
      tenant: updatedTenant
    });
  } catch (error) {
    console.error('Error marking profile as complete:', error);
    return NextResponse.json(
      { error: 'Failed to mark profile as complete' },
      { status: 500 }
    );
  }
}
