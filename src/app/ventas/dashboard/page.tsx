import React from 'react';
import { SalesDashboard } from '@/app/ventas/components/SalesDashboard';
import DailyStats from '@/app/ventas/components/DailyStats';
import { requirePermission } from '@/lib/auth-helpers';

export default async function DashboardPage() {
  await requirePermission('view_sales');

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Dashboard de Ventas</h1>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <DailyStats />
        </div>
        <div className="lg:col-span-3">
          <SalesDashboard />
        </div>
      </div>
    </div>
  );
}
