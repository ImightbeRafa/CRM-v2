import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { readTenantUiReadiness } from '@/lib/feature-flags';
import { mutateSetupProgress, readSetupProgress, SetupProgressError } from '@/lib/setup-progress';

/**
 * POST /api/setup/wizard-complete
 * Marks the profile as completed for the current tenant
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    const { tenantId } = auth;

    const readiness = await readTenantUiReadiness(tenantId);
    let setupProgress = null;
    if (readiness.setupGuide) {
      try {
        const current = await readSetupProgress(tenantId);
        setupProgress = await mutateSetupProgress({
          tenantId,
          action: 'finish',
          expectedRevision: current.revision,
        });
      } catch (error) {
        if (String((error as { code?: unknown })?.code || '') !== 'P2021') throw error;
        // Preserve the legacy completion path if code is deployed before the
        // separately approved setup-progress table.
      }
    }

    // Preserve the legacy profile marker for old clients while v2 guide state
    // remains the source of truth when its tenant flag is enabled.
    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { profileCompleted: true } as any,
      select: { id: true, profileCompleted: true } as any
    });

    return NextResponse.json({ 
      success: true,
      message: 'Profile marked as completed',
      tenant: updatedTenant,
      setupProgress,
    });
  } catch (error) {
    if (error instanceof SetupProgressError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error marking profile as complete:', error);
    return NextResponse.json(
      { error: 'Failed to mark profile as complete' },
      { status: 500 }
    );
  }
}
