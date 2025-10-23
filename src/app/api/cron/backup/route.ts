import { NextRequest, NextResponse } from 'next/server';
// NOTE: Backup functionality is disabled for build
// import { createDailyBackup } from '@/scripts/backup-database';

export async function GET(request: NextRequest) {
  try {
    // Verify this is a legitimate cron request
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (!cronSecret) {
      console.error('❌ CRON_SECRET not configured');
      return NextResponse.json(
        { error: 'Cron secret not configured' },
        { status: 500 }
      );
    }
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.error('❌ Invalid cron authorization');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('⚠️  Backup functionality is currently disabled');
    
    return NextResponse.json({
      success: false,
      message: 'Backup functionality is currently disabled',
      timestamp: new Date().toISOString(),
    }, { status: 503 });

  } catch (error) {
    console.error('❌ Automated backup failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Backup failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// Allow POST requests as well (for manual triggers)
export async function POST(request: NextRequest) {
  try {
    // For POST requests, we can add additional authentication
    // or allow manual triggers with proper API key
    
    const apiKey = request.headers.get('x-api-key');
    const expectedApiKey = process.env.BACKUP_API_KEY;
    
    if (expectedApiKey && apiKey !== expectedApiKey) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    console.log('⚠️  Backup functionality is currently disabled');
    
    return NextResponse.json({
      success: false,
      message: 'Backup functionality is currently disabled',
      timestamp: new Date().toISOString(),
    }, { status: 503 });

  } catch (error) {
    console.error('❌ Manual backup failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Manual backup failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
