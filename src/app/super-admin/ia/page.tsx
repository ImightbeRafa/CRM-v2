import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import AiUsageDashboard from './AiUsageDashboard'

/** Uso y costo de IA en todo Betsy (agentes, pruebas, bot del staff…). Solo el dueño de la plataforma. */
export default async function AiUsagePage() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  return (
    <AuroraClassicPage
      title="Uso de IA"
      subtitle="Cuánto usa y cuesta la IA en todo Betsy: por negocio, modelo, función y agente"
      maxWidthClass="max-w-none"
      testId="ai-usage-aurora"
    >
      <AiUsageDashboard />
    </AuroraClassicPage>
  )
}
