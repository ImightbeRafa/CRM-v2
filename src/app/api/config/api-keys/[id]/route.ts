import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { revokeApiKey } from '@/lib/integration-auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: keyId } = await params;
    const auth = await authenticateAPI(req);
    if (!auth.ok) {
      return auth.response;
    }

    const success = await revokeApiKey(keyId, auth.tenantId);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      status: 'success',
      message: 'API key revoked successfully'
    });
  } catch (error) {
    console.error('Error revoking API key:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
