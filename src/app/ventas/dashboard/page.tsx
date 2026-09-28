import React from 'react';
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage';
import { SalesDashboard } from '@/app/ventas/components/SalesDashboard';
import DailyStats from '@/app/ventas/components/DailyStats';
import { requirePermission } from '@/lib/auth-helpers';

export default async function DashboardPage() {
  await requirePermission('view_sales');

  return (
    <AuroraClassicPage title="Dashboard de Ventas" subtitle="Resumen diario y detalle de ventas" testId="ventas-dashboard-aurora">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <DailyStats />
        </div>
        <div className="lg:col-span-3">
          <SalesDashboard />
        </div>
      </div>
    </AuroraClassicPage>
  );
}
