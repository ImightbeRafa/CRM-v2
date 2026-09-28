import { redirect } from 'next/navigation';
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma as globalPrisma } from '@/lib/db';
import SuperAdminDashboard from './components/SuperAdminDashboard';

export default async function SuperAdminPage() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    redirect('/auth/signin');
  }

  // Check if user is super admin
  const user = await globalPrisma.user.findUnique({
    where: { email: session.user.email },
    select: { isSuperAdmin: true }
  });

  if (!user?.isSuperAdmin) {
    redirect('/dashboard'); // Redirect non-super-admins to regular dashboard
  }

  return (
    <AuroraClassicPage title="Super admin" subtitle="Administración de la plataforma" maxWidthClass="max-w-none" testId="super-admin-aurora">
      <SuperAdminDashboard />
    </AuroraClassicPage>
  );
}
