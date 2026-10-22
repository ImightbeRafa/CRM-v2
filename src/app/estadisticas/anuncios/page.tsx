import { requirePermission } from '@/lib/auth-helpers'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'
import { AdSalesView } from '@/components/insights/AdSalesView'

export default async function EstadisticasAnunciosPage() {
  await requirePermission('view_statistics')
  return (
    <AuroraShell bottomNav={<AuroraMobileNav />}>
      <AdSalesView />
    </AuroraShell>
  )
}
