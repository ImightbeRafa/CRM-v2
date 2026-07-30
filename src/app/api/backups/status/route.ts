import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getBackupStatus } from '@/lib/backups/service';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;

    if (!auth.role || !['OWNER', 'ADMIN'].includes(auth.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view backup status' },
        { status: 403 },
      );
    }

    const status = await getBackupStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Error fetching backup status:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch backup status',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
