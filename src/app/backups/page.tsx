import { requirePermission } from '@/lib/auth-helpers';
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage';
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
    <AuroraClassicPage title="Respaldos" subtitle="Copias de seguridad de tus datos" testId="backups-aurora">
      <BackupDashboard />
    </AuroraClassicPage>
  );
}
