import { requirePermission } from "@/lib/auth-helpers"
import EstadisticasDashboard from "./components/EstadisticasDashboard";
import { AppShell } from "@/app/components/AppShell";

export default async function EstadisticasPage() {
  await requirePermission('view_statistics')

  return (
    <AppShell>
      <div className="w-full px-3 md:px-4 lg:px-6 py-3 md:py-4">
        <EstadisticasDashboard />
      </div>
    </AppShell>
  );
}