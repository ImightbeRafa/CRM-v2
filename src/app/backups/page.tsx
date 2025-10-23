import { requirePermission } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import BackupDashboard from './components/BackupDashboard';

export default async function BackupsPage() {
  try {
    // Only OWNER and ADMIN can access backup dashboard
    await requirePermission('view_config');
  } catch (error) {
    redirect('/unauthorized');
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Backup Dashboard</h1>
          <p className="mt-2 text-gray-600">
            Monitor your database backups, restore data, and manage retention policies.
          </p>
        </div>
        
        <BackupDashboard />
      </div>
    </div>
  );
}
