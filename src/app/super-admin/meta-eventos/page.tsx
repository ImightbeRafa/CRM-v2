import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import MetaEventLog from './MetaEventLog'

/** Ad sales events sent to Meta (chat from an ad → order → paid → event). Betsy platform admins only. */
export default async function MetaEventosPage() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  return (
    <AuroraClassicPage
      title="Eventos de Meta"
      subtitle="Ventas por anuncios enviadas a Meta (WhatsApp e Instagram)"
      maxWidthClass="max-w-none"
      testId="meta-eventos-aurora"
    >
      <MetaEventLog />
    </AuroraClassicPage>
  )
}
