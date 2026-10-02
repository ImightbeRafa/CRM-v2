import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import HealthDashboard from './HealthDashboard'

/** Platform health (backups + errors). Betsy platform admins only. */
export default async function SaludPage() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  return (
    <AuroraClassicPage title="Salud de la plataforma" subtitle="Respaldos y errores en vivo" maxWidthClass="max-w-none" testId="salud-aurora">
      <HealthDashboard />
    </AuroraClassicPage>
  )
}
