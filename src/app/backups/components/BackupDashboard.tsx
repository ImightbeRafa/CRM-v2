'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import {
  Database,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';

interface ManifestSummary {
  kind: 'full' | 'hot';
  runId: string;
  startedAt: string;
  finishedAt: string;
  hoursAgo: number;
  discoveredTables: number;
  totalLogicalRows: number;
  totalCompressedBytes: number;
  requiredLmMissing: string[];
  materialized: number;
  reused: number;
  carriedForward: number;
  ok: boolean;
}

interface BackupStatus {
  formatVersion: number;
  isHealthy: boolean;
  status: 'healthy' | 'degraded' | 'missing';
  retentionDays: number;
  full: ManifestSummary | null;
  hot: ManifestSummary | null;
  recentManifests: ManifestSummary[];
  recommendations: Array<{ type: string; message: string; action: string }>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function SummaryCard({ title, summary }: { title: string; summary: ManifestSummary | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {summary
            ? `${Math.round(summary.hoursAgo)}h ago · ${summary.runId}`
            : 'No manifest yet'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {summary ? (
          <>
            <div className="flex justify-between"><span>Tables</span><span>{summary.discoveredTables}</span></div>
            <div className="flex justify-between"><span>Rows</span><span>{summary.totalLogicalRows.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Stored</span><span>{formatBytes(summary.totalCompressedBytes)}</span></div>
            <div className="flex justify-between"><span>Materialized / reused / carried</span>
              <span>{summary.materialized}/{summary.reused}/{summary.carriedForward}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>lm_* coverage</span>
              {summary.requiredLmMissing.length === 0 ? (
                <Badge variant="default" className="bg-emerald-600">complete</Badge>
              ) : (
                <Badge variant="destructive">missing {summary.requiredLmMissing.length}</Badge>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Waiting for first successful run.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function BackupDashboard() {
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void fetchBackupStatus();
  }, []);

  if (loading && !backupStatus) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading backup status…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Database className="h-6 w-6" /> Database backups
          </h1>
          <p className="text-muted-foreground mt-1">
            Private Vercel Blob snapshots (full 02:00 UTC, hot 14:00 UTC). Logistics <code>lm_*</code> included.
          </p>
        </div>
        <Button variant="outline" onClick={() => void fetchBackupStatus()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {backupStatus && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {backupStatus.isHealthy ? (
              <Badge className="bg-emerald-600"><CheckCircle className="h-3 w-3 mr-1" /> healthy</Badge>
            ) : (
              <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> {backupStatus.status}</Badge>
            )}
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" /> format v{backupStatus.formatVersion} · private blob
            </span>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> retention {backupStatus.retentionDays} days
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SummaryCard title="Latest full backup" summary={backupStatus.full} />
            <SummaryCard title="Latest hot backup" summary={backupStatus.hot} />
          </div>

          {backupStatus.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommendations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {backupStatus.recommendations.map((rec, i) => (
                  <Alert key={i} variant={rec.type === 'critical' ? 'destructive' : 'default'}>
                    <AlertDescription>
                      <div className="font-medium">{rec.message}</div>
                      <div className="text-sm text-muted-foreground mt-1">{rec.action}</div>
                    </AlertDescription>
                  </Alert>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Operator notes</CardTitle>
              <CardDescription>
                Manual backups and restores are CLI/API only (never from this browser).
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <p>Full cron: <code>GET /api/cron/backup</code> with <code>Authorization: Bearer $CRON_SECRET</code></p>
              <p>Hot cron: <code>GET /api/cron/backup/hot</code> with the same secret</p>
              <p>Manual: <code>POST /api/cron/backup</code> with <code>x-api-key: $BACKUP_API_KEY</code></p>
              <p>Restore: <code>npx tsx scripts/restore-from-backup.ts list|verify|restore &lt;runId&gt; --apply</code></p>
              <p>Coverage check: <code>npm run backup:coverage</code></p>
            </CardContent>
          </Card>

          {backupStatus.recentManifests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent manifests</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-2 pr-3">Kind</th>
                        <th className="py-2 pr-3">Run</th>
                        <th className="py-2 pr-3">Tables</th>
                        <th className="py-2 pr-3">Rows</th>
                        <th className="py-2 pr-3">Age</th>
                        <th className="py-2">lm_*</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backupStatus.recentManifests.map((m) => (
                        <tr key={`${m.kind}-${m.runId}`} className="border-b last:border-0">
                          <td className="py-2 pr-3">{m.kind}</td>
                          <td className="py-2 pr-3 font-mono text-xs">{m.runId}</td>
                          <td className="py-2 pr-3">{m.discoveredTables}</td>
                          <td className="py-2 pr-3">{m.totalLogicalRows.toLocaleString()}</td>
                          <td className="py-2 pr-3">{Math.round(m.hoursAgo)}h</td>
                          <td className="py-2">{m.requiredLmMissing.length === 0 ? 'ok' : 'missing'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
