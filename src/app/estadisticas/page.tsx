import { requirePermission } from "@/lib/auth-helpers"
import EstadisticasDashboard from "./components/EstadisticasDashboard";
import { AppShell } from "@/app/components/AppShell";

export default async function EstadisticasPage() {
  await requirePermission('view_statistics')

  return (
    <AppShell>
      <div className="container mx-auto px-4 md:px-6 py-4 md:py-6">
        <EstadisticasDashboard />
      </div>
    </AppShell>
  );
}