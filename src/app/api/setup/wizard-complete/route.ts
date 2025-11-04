import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/setup/wizard-complete
 * Marks the setup wizard as completed for the current tenant
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = (session.user as any).tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant found' },
        { status: 400 }
      );
    }

    // Update tenant to mark wizard as completed
    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { setupWizardCompleted: true },
      select: { id: true, setupWizardCompleted: true }
    });

    console.log(`✅ Setup wizard marked as completed for tenant ${tenantId}`);

    return NextResponse.json({ 
      success: true,
      message: 'Setup wizard marked as completed',
      tenant: updatedTenant
    });
  } catch (error) {
    console.error('Error marking wizard as complete:', error);
    return NextResponse.json(
      { error: 'Failed to mark wizard as complete' },
      { status: 500 }
    );
  }
}

