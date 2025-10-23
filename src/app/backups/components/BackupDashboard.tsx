'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import { 
  Database, 
  Download, 
  Upload, 
  Trash2, 
  Clock, 
  Shield, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw
} from 'lucide-react';

interface BackupStatus {
  status: string;
  isHealthy: boolean;
  totalBackups: number;
  totalSize: {
    bytes: number;
    mb: string;
    gb: string;
  };
  lastBackup: {
    name: string;
    createdAt: string;
    size: number;
    url: string;
    hoursAgo: number;
  } | null;
  retention: {
    policy: string;
    oldBackups: number;
    shouldCleanup: boolean;
  };
  frequency: {
    averageInterval: number | null;
    consistency: string;
    missingDays: Array<{
      from: string;
      to: string;
      gapHours: number;
    }>;
  };
  recommendations: Array<{
    type: string;
    message: string;
    action: string;
  }>;
}

export default function BackupDashboard() {
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchBackupStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/backups/status');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setBackupStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch backup status');
    } finally {
      setLoading(false);
    }
  };

  const triggerBackup = async () => {
    try {
      setActionLoading('backup');
      
      const response = await fetch('/api/cron/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Backup failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('Backup triggered:', result);
      
      // Refresh status after backup
      await fetchBackupStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger backup');
    } finally {
      setActionLoading(null);
    }
  };

  const cleanupOldBackups = async () => {
    try {
      setActionLoading('cleanup');
      
      // This would call a cleanup API endpoint
      // For now, we'll just refresh the status
      await fetchBackupStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cleanup old backups');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchBackupStatus();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-2 text-gray-600">Loading backup status...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="mb-6">
        <XCircle className="h-4 w-4" />
        <AlertDescription>
          Error loading backup status: {error}
        </AlertDescription>
      </Alert>
    );
  }

  if (!backupStatus) {
    return (
      <Alert className="mb-6">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No backup status data available.
        </AlertDescription>
      </Alert>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'missing':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-800';
      case 'missing':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            {getStatusIcon(backupStatus.status)}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              <Badge className={getStatusColor(backupStatus.status)}>
                {backupStatus.status.toUpperCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {backupStatus.isHealthy ? 'All systems operational' : 'Issues detected'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Backups</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{backupStatus.totalBackups}</div>
            <p className="text-xs text-muted-foreground">
              {backupStatus.totalSize.gb} GB total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last Backup</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {backupStatus.lastBackup ? `${Math.round(backupStatus.lastBackup.hoursAgo)}h` : 'Never'}
            </div>
            <p className="text-xs text-muted-foreground">
              {backupStatus.lastBackup 
                ? new Date(backupStatus.lastBackup.createdAt).toLocaleDateString()
                : 'No backups found'
              }
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Retention</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{backupStatus.retention.policy}</div>
            <p className="text-xs text-muted-foreground">
              {backupStatus.retention.oldBackups} old backups
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Backup Actions</CardTitle>
          <CardDescription>
            Manage your database backups and retention policies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <Button 
              onClick={triggerBackup}
              disabled={actionLoading === 'backup'}
              className="flex items-center gap-2"
            >
              {actionLoading === 'backup' ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4" />
              )}
              {actionLoading === 'backup' ? 'Creating Backup...' : 'Create Backup Now'}
            </Button>

            <Button 
              onClick={fetchBackupStatus}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Status
            </Button>

            {backupStatus.retention.shouldCleanup && (
              <Button 
                onClick={cleanupOldBackups}
                disabled={actionLoading === 'cleanup'}
                variant="destructive"
                className="flex items-center gap-2"
              >
                {actionLoading === 'cleanup' ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {actionLoading === 'cleanup' ? 'Cleaning...' : 'Cleanup Old Backups'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      {backupStatus.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Recommendations
            </CardTitle>
            <CardDescription>
              Important actions to improve your backup system.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {backupStatus.recommendations.map((rec, index) => (
                <Alert key={index} className={
                  rec.type === 'critical' ? 'border-red-200 bg-red-50' :
                  rec.type === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                  'border-blue-200 bg-blue-50'
                }>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-medium">{rec.message}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {rec.action}
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backup Details */}
      {backupStatus.lastBackup && (
        <Card>
          <CardHeader>
            <CardTitle>Latest Backup Details</CardTitle>
            <CardDescription>
              Information about your most recent backup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Filename</label>
                <p className="text-sm">{backupStatus.lastBackup.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Size</label>
                <p className="text-sm">{(backupStatus.lastBackup.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Created</label>
                <p className="text-sm">
                  {new Date(backupStatus.lastBackup.createdAt).toLocaleString()}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Age</label>
                <p className="text-sm">
                  {Math.round(backupStatus.lastBackup.hoursAgo)} hours ago
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
