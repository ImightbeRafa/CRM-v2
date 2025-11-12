import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getIntegrationStats } from '@/lib/integration-logs';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req);
    if (!auth.ok) {
      return auth.response;
    }

    const stats = await getIntegrationStats(auth.tenantId);
    
    return NextResponse.json({
      status: 'success',
      data: stats
    });
  } catch (error) {
    console.error('Error fetching integration stats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
