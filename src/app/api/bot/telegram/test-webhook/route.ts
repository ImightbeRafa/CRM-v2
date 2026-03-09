/**
 * MINIMAL TEST WEBHOOK
 * This is a diagnostic endpoint to verify the webhook is being called
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  console.log('🔥🔥🔥 TEST WEBHOOK CALLED 🔥🔥🔥');
  console.log('🔥 Timestamp:', new Date().toISOString());
  
  try {
    const body = await request.json();
    console.log('🔥 Body received:', JSON.stringify(body).substring(0, 200));
    
    return NextResponse.json({ 
      ok: true, 
      message: 'Test webhook working',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('🔥 ERROR:', error.message);
    return NextResponse.json({ 
      ok: false, 
      error: 'Test webhook failed' 
    });
  }
}

export async function GET(request: NextRequest) {
  console.log('🔥 GET request to test webhook');
  return NextResponse.json({ 
    ok: true, 
    message: 'Test webhook GET endpoint',
    timestamp: new Date().toISOString()
  });
}

