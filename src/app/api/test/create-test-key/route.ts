import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { createApiKey } from '@/lib/integration-auth';

/**
 * Test endpoint to quickly create an API key for testing
 * This is useful during development to quickly get a test key
 * 
 * DELETE THIS FILE IN PRODUCTION!
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req);
    if (!auth.ok) {
      return auth.response;
    }

    const result = await createApiKey(auth.tenantId, 'Test API Key - ' + new Date().toISOString());
    
    return NextResponse.json({
      status: 'success',
      message: 'Test API key created',
      apiKey: result.apiKey,
      id: result.id,
      instructions: [
        'Copy the API key above',
        'Replace YOUR_API_KEY_HERE in test-integration-endpoint.js',
        'Run: node test-integration-endpoint.js',
        'Check your orders at /produccion'
      ]
    });
  } catch (error) {
    console.error('Error creating test API key:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
