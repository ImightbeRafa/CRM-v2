import { NextRequest, NextResponse } from 'next/server';

// Configure route for Vercel deployment
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// Helper to mask sensitive header values
function maskSensitiveHeaders(headers: Headers): Record<string, string> {
  const sensitiveKeys = ['authorization', 'x-api-key', 'cookie', 'x-auth-token'];
  const result: Record<string, string> = {};
  
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      // Mask sensitive values - show only first 4 and last 4 chars
      result[key] = value.length > 10 
        ? `${value.substring(0, 4)}***${value.substring(value.length - 4)}`
        : '****';
    } else {
      result[key] = value;
    }
  });
  
  return result;
}

/**
 * Simple test endpoint to verify integration connectivity
 * No authentication required - just for testing
 */
export async function GET(req: NextRequest) {
  // Only log in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[Integration Test] GET request received');
    console.log('[Integration Test] Headers (masked):', maskSensitiveHeaders(req.headers));
  }
  
  return NextResponse.json({
    success: true,
    message: 'Integration API is working!',
    timestamp: new Date().toISOString(),
    receivedFrom: req.headers.get('origin') || 'unknown',
  });
}

export async function POST(req: NextRequest) {
  // Only log in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[Integration Test] POST request received');
    console.log('[Integration Test] Headers (masked):', maskSensitiveHeaders(req.headers));
  }
  
  try {
    const body = await req.json();
    
    // Only log body in development, and limit size
    if (process.env.NODE_ENV === 'development') {
      const bodyStr = JSON.stringify(body);
      console.log('[Integration Test] Body preview:', bodyStr.substring(0, 200) + (bodyStr.length > 200 ? '...' : ''));
    }
    
    return NextResponse.json({
      success: true,
      message: 'Integration API received your POST request!',
      timestamp: new Date().toISOString(),
      receivedFrom: req.headers.get('origin') || 'unknown',
      // Don't echo back full body in production - could leak sensitive data
      receivedData: process.env.NODE_ENV === 'development' ? body : { keys: Object.keys(body) },
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
