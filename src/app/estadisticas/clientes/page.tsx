import { requirePermission } from '@/lib/auth-helpers'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'
import { CustomersView } from '@/components/insights/CustomersView'

// Customer names / phones: the APIs also require view_sales (the view explains when it is missing).
export default async function EstadisticasClientesPage() {
  await requirePermission('view_statistics')
  return (
    <AuroraShell bottomNav={<AuroraMobileNav />}>
      <CustomersView />
    </AuroraShell>
  )
}
