'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import { 
  Shield, 
  Download, 
  Upload, 
  RotateCcw, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Clock,
  Database,
  HardDrive, // Using HardDrive instead of HardDrive
  Settings,
  RefreshCw,
  Play,
  Pause,
  AlertCircle
} from 'lucide-react';

interface DeploymentChecklist {
  preDeployment: {
    database: CheckResult;
    backups: CheckResult;
    environment: CheckResult;
    dependencies: CheckResult;
  };
  deployment: {
    build: CheckResult;
    tests: CheckResult;
    security: CheckResult;
    performance: CheckResult;
  };
  postDeployment: {
    health: CheckResult;
    monitoring: CheckResult;
    rollback: CheckResult;
  };
  summary: {
    overallStatus: string;
    passedChecks: number;
    totalChecks: number;
    successRate: number;
  };
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  details: any;
  message: string;
}

export default function DeploymentDashboard() {
  const [checklist, setChecklist] = useState<DeploymentChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchChecklist = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/deployment/checklist');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setChecklist(data.checklist);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch deployment checklist');
    } finally {
      setLoading(false);
    }
  };

  const runPreDeployHardDrive = async () => {
    try {
      setActionLoading('backup');
      
      // This would trigger the pre-deploy backup script
      const response = await fetch('/api/deployment/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`HardDrive failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('Pre-deploy backup triggered:', result);
      
      // Refresh checklist after backup
      await fetchChecklist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger pre-deploy backup');
    } finally {
      setActionLoading(null);
    }
  };

  const runRollback = async () => {
    try {
      setActionLoading('rollback');
      
      // This would trigger the rollback script
      const response = await fetch('/api/deployment/rollback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Rollback failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('Rollback triggered:', result);
      
      // Refresh checklist after rollback
      await fetchChecklist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger rollback');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchChecklist();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-2 text-gray-600">Loading deployment checklist...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="mb-6">
        <XCircle className="h-4 w-4" />
        <AlertDescription>
          Error loading deployment checklist: {error}
        </AlertDescription>
      </Alert>
    );
  }

  if (!checklist) {
    return (
      <Alert className="mb-6">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No deployment checklist data available.
        </AlertDescription>
      </Alert>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'warn':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pass':
        return 'bg-green-100 text-green-800';
      case 'fail':
        return 'bg-red-100 text-red-800';
      case 'warn':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const CheckResultCard = ({ check }: { check: CheckResult }) => (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex items-center gap-3">
        {getStatusIcon(check.status)}
        <div>
          <div className="font-medium">{check.name}</div>
          <div className="text-sm text-gray-600">{check.message}</div>
        </div>
      </div>
      <Badge className={getStatusColor(check.status)}>
        {check.status.toUpperCase()}
      </Badge>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Overall Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Deployment Safety Status
          </CardTitle>
          <CardDescription>
            Overall deployment readiness and safety status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600">
                {checklist.summary.successRate}%
              </div>
              <div className="text-sm text-gray-600">Success Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {checklist.summary.passedChecks}
              </div>
              <div className="text-sm text-gray-600">Passed Checks</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {checklist.summary.totalChecks - checklist.summary.passedChecks}
              </div>
              <div className="text-sm text-gray-600">Failed Checks</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                <Badge className={
                  checklist.summary.overallStatus === 'ready' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-red-100 text-red-800'
                }>
                  {checklist.summary.overallStatus.toUpperCase()}
                </Badge>
              </div>
              <div className="text-sm text-gray-600">Overall Status</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pre-Deployment Checks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Pre-Deployment Checks
          </CardTitle>
          <CardDescription>
            Verify system readiness before deployment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CheckResultCard check={checklist.preDeployment.database} />
          <CheckResultCard check={checklist.preDeployment.backups} />
          <CheckResultCard check={checklist.preDeployment.environment} />
          <CheckResultCard check={checklist.preDeployment.dependencies} />
        </CardContent>
      </Card>

      {/* Deployment Checks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Deployment Checks
          </CardTitle>
          <CardDescription>
            Verify build, tests, security, and performance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CheckResultCard check={checklist.deployment.build} />
          <CheckResultCard check={checklist.deployment.tests} />
          <CheckResultCard check={checklist.deployment.security} />
          <CheckResultCard check={checklist.deployment.performance} />
        </CardContent>
      </Card>

      {/* Post-Deployment Checks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Post-Deployment Checks
          </CardTitle>
          <CardDescription>
            Verify system health after deployment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CheckResultCard check={checklist.postDeployment.health} />
          <CheckResultCard check={checklist.postDeployment.monitoring} />
          <CheckResultCard check={checklist.postDeployment.rollback} />
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Deployment Actions</CardTitle>
          <CardDescription>
            Manage deployment safety and rollback procedures.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <Button 
              onClick={runPreDeployHardDrive}
              disabled={actionLoading === 'backup'}
              className="flex items-center gap-2"
            >
              {actionLoading === 'backup' ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <HardDrive className="h-4 w-4" />
              )}
              {actionLoading === 'backup' ? 'Creating HardDrive...' : 'Create Pre-Deploy HardDrive'}
            </Button>

            <Button 
              onClick={runRollback}
              disabled={actionLoading === 'rollback'}
              variant="destructive"
              className="flex items-center gap-2"
            >
              {actionLoading === 'rollback' ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {actionLoading === 'rollback' ? 'Rolling Back...' : 'Rollback Deployment'}
            </Button>

            <Button 
              onClick={fetchChecklist}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Checklist
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Deployment Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Deployment Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">Pre-Deployment Safety</h4>
              <ul className="text-sm text-gray-600 mt-2 space-y-1">
                <li>• Always create a backup before deployment</li>
                <li>• Verify all checks pass before proceeding</li>
                <li>• Test in staging environment first</li>
                <li>• Have rollback plan ready</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium">Rollback Procedures</h4>
              <ul className="text-sm text-gray-600 mt-2 space-y-1">
                <li>• Rollback restores database to pre-deployment state</li>
                <li>• All data changes since deployment will be lost</li>
                <li>• Rollback should be used only in emergencies</li>
                <li>• Test rollback procedures regularly</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium">Best Practices</h4>
              <ul className="text-sm text-gray-600 mt-2 space-y-1">
                <li>• Deploy during low-traffic hours</li>
                <li>• Monitor system health after deployment</li>
                <li>• Keep deployment records for audit</li>
                <li>• Train team on rollback procedures</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
