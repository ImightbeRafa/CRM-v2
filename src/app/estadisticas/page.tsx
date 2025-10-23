import { requirePermission } from "@/lib/auth-helpers"
import EstadisticasDashboard from "./components/EstadisticasDashboard";
import HomeButton from "@/app/components/ui/HomeButtom";

export default async function EstadisticasPage() {
  // Require 'view_statistics' permission (SALES users will be redirected!)
  await requirePermission('view_statistics')

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3">
          <HomeButton />
        </div>
      </nav>
      <div className="container mx-auto p-6">
        <EstadisticasDashboard />
      </div>
    </div>
  );
}