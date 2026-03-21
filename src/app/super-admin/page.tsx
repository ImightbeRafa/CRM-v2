import { redirect } from 'next/navigation';
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
    <div className="min-h-screen bg-muted">
      <SuperAdminDashboard />
    </div>
  );
}
