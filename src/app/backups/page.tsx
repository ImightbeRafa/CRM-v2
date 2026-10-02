import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage';
import { authOptions } from '@/lib/auth-options';
import { isSuperAdmin } from '@/lib/super-admin-helpers';
import BackupDashboard from './components/BackupDashboard';

/** Platform backups (every business's data): Betsy platform admins only. */
export default async function BackupsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/auth/signin');
  if (!(await isSuperAdmin(userId))) redirect('/dashboard');

  return (
    <AuroraClassicPage title="Respaldos" subtitle="Copias de seguridad de la plataforma" testId="backups-aurora">
      <BackupDashboard />
    </AuroraClassicPage>
  );
}
