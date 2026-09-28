import { requirePermission } from '@/lib/auth-helpers';
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage';
import { redirect } from 'next/navigation';
import ExportDashboard from './components/ExportDashboard';

export default async function ExportsPage() {
  try {
    // Only authenticated users can access export dashboard
    await requirePermission('view_sales');
  } catch (error) {
    redirect('/unauthorized');
  }

  return (
    <AuroraClassicPage
      title="Exportar datos"
      subtitle="Descargá tus pedidos, clientes y ventas en varios formatos"
      testId="exports-aurora"
    >
      <ExportDashboard />
    </AuroraClassicPage>
  );
}
