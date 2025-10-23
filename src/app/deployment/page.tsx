import { requirePermission } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import DeploymentDashboard from './components/DeploymentDashboard';

export default async function DeploymentPage() {
  try {
    // Only OWNER and ADMIN can access deployment dashboard
    await requirePermission('view_config');
  } catch (error) {
    redirect('/unauthorized');
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Deployment Safety</h1>
          <p className="mt-2 text-gray-600">
            Manage safe deployments with pre-deployment backups, rollback procedures, and health monitoring.
          </p>
        </div>
        
        <DeploymentDashboard />
      </div>
    </div>
  );
}
