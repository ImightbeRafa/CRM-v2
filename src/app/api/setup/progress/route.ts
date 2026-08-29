import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { readTenantUiReadiness } from '@/lib/feature-flags';
import {
  mutateSetupProgress,
  readSetupProgress,
  SetupProgressError,
  type SetupProgressAction,
} from '@/lib/setup-progress';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function unavailable() {
  return NextResponse.json({ enabled: false, progress: null });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    if (!(await readTenantUiReadiness(auth.tenantId)).setupGuide) return unavailable();
    return NextResponse.json({ enabled: true, progress: await readSetupProgress(auth.tenantId) });
  } catch (error) {
    if (String((error as { code?: unknown })?.code || '') === 'P2021') return unavailable();
    console.error('[Setup progress] Read failed', { errorName: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json({ error: 'Unable to load setup progress' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    if (!(await readTenantUiReadiness(auth.tenantId)).setupGuide) {
      return NextResponse.json({ error: 'Setup guide v2 is not enabled' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const allowed = new Set<SetupProgressAction>(['visit', 'complete', 'skip', 'dismiss', 'finish', 'restart']);
    if (!allowed.has(body.action)) {
      return NextResponse.json({ error: 'Invalid setup progress action' }, { status: 400 });
    }
    const progress = await mutateSetupProgress({
      tenantId: auth.tenantId,
      action: body.action,
      step: body.step,
      expectedRevision: body.expectedRevision,
    });
    return NextResponse.json({ enabled: true, progress });
  } catch (error) {
    if (error instanceof SetupProgressError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (String((error as { code?: unknown })?.code || '') === 'P2021') {
      return NextResponse.json({ error: 'Setup guide v2 is not available' }, { status: 503 });
    }
    console.error('[Setup progress] Mutation failed', { errorName: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json({ error: 'Unable to save setup progress' }, { status: 500 });
  }
}
