import { requirePermission } from '@/lib/auth-helpers'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'
import { TeamChatView } from '@/components/insights/TeamChatView'

export default async function EstadisticasEquipoPage() {
  await requirePermission('view_statistics')
  return (
    <AuroraShell bottomNav={<AuroraMobileNav />}>
      <TeamChatView />
    </AuroraShell>
  )
}
