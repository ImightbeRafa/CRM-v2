import { requirePermission } from "@/lib/auth-helpers"
import { readTenantUiReadiness } from '@/lib/feature-flags'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'
import { AuroraStatsDashboard } from '@/components/aurora/estadisticas/AuroraStatsDashboard'

export default async function EstadisticasPage() {
  const { session } = await requirePermission('view_statistics')
  const tenantId = (session.user as any).tenantId as string | undefined;
  const readiness = tenantId
    ? await readTenantUiReadiness(tenantId)
    : { statistics: { enabled: false, mode: 'observe' as const } };

  return (
    <AuroraShell bottomNav={<AuroraMobileNav />}>
      <AuroraStatsDashboard statistics={readiness.statistics} />
    </AuroraShell>
  );
}
