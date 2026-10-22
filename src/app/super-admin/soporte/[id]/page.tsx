import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import SupportInbox from '../SupportInbox'

/** Deep link from the notification email / webhook `admin_url` (Rafael only). */
export default async function SupportTicketAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  const { id } = await params
  return (
    <AuroraClassicPage title="Soporte" subtitle="Tickets, contactos y leads de agentes" maxWidthClass="max-w-none" testId="support-admin-aurora">
      <SupportInbox initialId={id.slice(0, 64)} />
    </AuroraClassicPage>
  )
}
