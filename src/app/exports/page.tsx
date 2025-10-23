import { requirePermission } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import ExportDashboard from './components/ExportDashboard';

export default async function ExportsPage() {
  try {
    // Only authenticated users can access export dashboard
    await requirePermission('view_sales');
  } catch (error) {
    redirect('/unauthorized');
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Data Exports</h1>
          <p className="mt-2 text-gray-600">
            Export your data in multiple formats for analysis, backup, or migration.
          </p>
        </div>
        
        <ExportDashboard />
      </div>
    </div>
  );
}
