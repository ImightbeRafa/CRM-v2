import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { createApiKey, listApiKeys } from '@/lib/integration-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req);
    if (!auth.ok) {
      return auth.response;
    }

    const apiKeys = await listApiKeys(auth.tenantId);
    
    return NextResponse.json({
      status: 'success',
      data: apiKeys
    });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req);
    if (!auth.ok) {
      return auth.response;
    }

    const { name } = await req.json();
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'API key name is required' },
        { status: 400 }
      );
    }

    const result = await createApiKey(auth.tenantId, name.trim());
    
    return NextResponse.json({
      status: 'success',
      data: {
        id: result.id,
        name: name.trim()
      },
      apiKey: result.apiKey // Only returned once during creation
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
