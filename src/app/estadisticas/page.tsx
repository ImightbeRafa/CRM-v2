import { requirePermission } from "@/lib/auth-helpers"
import EstadisticasDashboard from "./components/EstadisticasDashboard";
import { AppShell } from "@/app/components/AppShell";
import { readTenantUiReadiness } from '@/lib/feature-flags';

export default async function EstadisticasPage() {
  const { session } = await requirePermission('view_statistics')
  const tenantId = (session.user as any).tenantId as string | undefined;
  const readiness = tenantId
    ? await readTenantUiReadiness(tenantId)
    : { statistics: { enabled: false, mode: 'observe' as const } };

  return (
    <AppShell>
      <div className="w-full px-3 md:px-4 lg:px-6 py-3 md:py-4">
        <EstadisticasDashboard statisticsV2={readiness.statistics} />
      </div>
    </AppShell>
  );
}
