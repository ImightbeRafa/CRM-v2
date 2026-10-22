import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import SupportInbox from './SupportInbox'

/** Soporte: every ticket, contact and agent lead (Rafael only). */
export default async function SupportAdminPage() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  return (
    <AuroraClassicPage title="Soporte" subtitle="Tickets, contactos y leads de agentes" maxWidthClass="max-w-none" testId="support-admin-aurora">
      <SupportInbox />
    </AuroraClassicPage>
  )
}
