import { NextRequest, NextResponse } from 'next/server';

// Configure route for Vercel deployment
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Simple test endpoint to verify integration connectivity
 * No authentication required - just for testing
 */
export async function GET(req: NextRequest) {
  console.log('[Integration Test] GET request received');
  console.log('[Integration Test] Headers:', Object.fromEntries(req.headers.entries()));
  
  return NextResponse.json({
    success: true,
    message: 'Integration API is working!',
    timestamp: new Date().toISOString(),
    receivedFrom: req.headers.get('origin') || 'unknown',
  });
}

export async function POST(req: NextRequest) {
  console.log('[Integration Test] POST request received');
  console.log('[Integration Test] Headers:', Object.fromEntries(req.headers.entries()));
  
  try {
    const body = await req.json();
    console.log('[Integration Test] Body:', JSON.stringify(body, null, 2));
    
    return NextResponse.json({
      success: true,
      message: 'Integration API received your POST request!',
      timestamp: new Date().toISOString(),
      receivedFrom: req.headers.get('origin') || 'unknown',
      receivedData: body,
    });
  } catch (error) {
    console.error('[Integration Test] Error parsing body:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to parse request body',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 400 });
  }
}
