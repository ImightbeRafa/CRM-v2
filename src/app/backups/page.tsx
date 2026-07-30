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
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <BackupDashboard />
      </div>
    </div>
  );
}
