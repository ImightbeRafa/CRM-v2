import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import AgentOpsDashboard from './AgentOpsDashboard'

/** Agent Ops: usage, cost estimate and errors for the INBOX agents. Betsy platform admins only. */
export default async function AgentOpsPage() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  return (
    <AuroraClassicPage
      title="Agent Ops"
      subtitle="Uso, costo estimado y errores de los agentes del inbox"
      maxWidthClass="max-w-none"
      testId="agent-ops-aurora"
    >
      <AgentOpsDashboard />
    </AuroraClassicPage>
  )
}
