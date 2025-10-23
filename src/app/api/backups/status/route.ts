import { NextRequest, NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { authenticateAPI } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    // Authenticate the request
    const auth = await authenticateAPI(request);
    
    if (!auth.ok) {
      return auth.response;
    }
    
    // Check if user has permission to view backup status
    // Only OWNER and ADMIN can view backup information
    if (!auth.role || !['OWNER', 'ADMIN'].includes(auth.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions to view backup status' },
        { status: 403 }
      );
    }

    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    // Filter for backup files
    const backups = blobs
      .filter(blob => blob.pathname.startsWith('daily-backup-'))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    // Calculate statistics
    const totalBackups = backups.length;
    const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
    const lastBackup = backups[0];
    
    // Check if backup is recent (within 25 hours)
    const now = new Date();
    const lastBackupDate = lastBackup ? new Date(lastBackup.uploadedAt) : null;
    const hoursSinceLastBackup = lastBackupDate 
      ? (now.getTime() - lastBackupDate.getTime()) / (1000 * 60 * 60)
      : null;
    
    const isHealthy = hoursSinceLastBackup !== null && hoursSinceLastBackup < 25;
    const status = isHealthy ? 'healthy' : 'missing';

    // Get backup frequency analysis
    const backupFrequency = analyzeBackupFrequency(backups);
    
    // Calculate retention info
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
    const oldBackups = backups.filter(backup => {
      const backupDate = new Date(backup.uploadedAt);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      return backupDate < cutoffDate;
    });

    return NextResponse.json({
      status,
      isHealthy,
      totalBackups,
      totalSize: {
        bytes: totalSize,
        mb: (totalSize / 1024 / 1024).toFixed(2),
        gb: (totalSize / 1024 / 1024 / 1024).toFixed(2),
      },
      lastBackup: lastBackup ? {
        name: lastBackup.pathname,
        createdAt: lastBackup.uploadedAt,
        size: lastBackup.size,
        url: lastBackup.url,
        hoursAgo: hoursSinceLastBackup,
      } : null,
      retention: {
        policy: `${retentionDays} days`,
        oldBackups: oldBackups.length,
        shouldCleanup: oldBackups.length > 0,
      },
      frequency: backupFrequency,
      recommendations: generateRecommendations(backups, isHealthy, hoursSinceLastBackup),
    });

  } catch (error) {
    console.error('Error fetching backup status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch backup status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

function analyzeBackupFrequency(backups: any[]) {
  if (backups.length < 2) {
    return {
      averageInterval: null,
      consistency: 'insufficient_data',
      missingDays: [],
    };
  }

  // Calculate intervals between backups
  const intervals = [];
  for (let i = 1; i < backups.length; i++) {
    const prevDate = new Date(backups[i].uploadedAt);
    const currDate = new Date(backups[i - 1].uploadedAt);
    const intervalHours = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60);
    intervals.push(intervalHours);
  }

  const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  
  // Check for missing days (gaps > 30 hours)
  const missingDays = [];
  for (let i = 1; i < backups.length; i++) {
    const prevDate = new Date(backups[i].uploadedAt);
    const currDate = new Date(backups[i - 1].uploadedAt);
    const gapHours = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60);
    
    if (gapHours > 30) {
      missingDays.push({
        from: prevDate.toISOString().split('T')[0],
        to: currDate.toISOString().split('T')[0],
        gapHours: Math.round(gapHours),
      });
    }
  }

  // Determine consistency
  let consistency = 'excellent';
  if (averageInterval > 30) consistency = 'poor';
  else if (averageInterval > 26) consistency = 'fair';
  else if (averageInterval > 24) consistency = 'good';

  return {
    averageInterval: Math.round(averageInterval * 10) / 10,
    consistency,
    missingDays,
  };
}

function generateRecommendations(backups: any[], isHealthy: boolean, hoursSinceLastBackup: number | null) {
  const recommendations = [];

  if (!isHealthy) {
    if (hoursSinceLastBackup === null) {
      recommendations.push({
        type: 'critical',
        message: 'No backups found. Run backup immediately.',
        action: 'Execute backup script or check cron job configuration.',
      });
    } else if (hoursSinceLastBackup > 48) {
      recommendations.push({
        type: 'critical',
        message: `Last backup was ${Math.round(hoursSinceLastBackup)} hours ago.`,
        action: 'Check backup automation and run manual backup.',
      });
    } else {
      recommendations.push({
        type: 'warning',
        message: `Last backup was ${Math.round(hoursSinceLastBackup)} hours ago.`,
        action: 'Monitor backup automation.',
      });
    }
  }

  if (backups.length === 0) {
    recommendations.push({
      type: 'info',
      message: 'No backups available yet.',
      action: 'Run your first backup to get started.',
    });
  }

  // Check for old backups that should be cleaned up
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
  const oldBackups = backups.filter(backup => {
    const backupDate = new Date(backup.uploadedAt);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    return backupDate < cutoffDate;
  });

  if (oldBackups.length > 0) {
    recommendations.push({
      type: 'info',
      message: `${oldBackups.length} old backups can be cleaned up.`,
      action: 'Run cleanup script to free storage space.',
    });
  }

  // Check backup frequency
  if (backups.length >= 7) {
    const recentBackups = backups.slice(0, 7);
    const daysWithBackups = new Set(
      recentBackups.map(backup => 
        new Date(backup.uploadedAt).toISOString().split('T')[0]
      )
    ).size;

    if (daysWithBackups < 5) {
      recommendations.push({
        type: 'warning',
        message: 'Backup frequency is inconsistent.',
        action: 'Check cron job schedule and automation.',
      });
    }
  }

  return recommendations;
}
