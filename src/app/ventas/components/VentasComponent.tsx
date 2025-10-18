'use client';

import React from 'react';
import HomeButton from '@/app/components/ui/HomeButtom';
import ClientOnlySalesForm from '@/app/ventas/components/ClientOnlySalesForm';
import { SalesDashboard } from '@/app/ventas/components/SalesDashboard';
import DailyStats from '@/app/ventas/components/DailyStats';
import SalesErrorBoundary from '@/app/ventas/components/SalesErrorBoundary';

export default function VentasContent() {
  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-3">
          <HomeButton />
        </div>
      </nav>

      <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6" style={{ overflow: 'visible' }}>
        <SalesErrorBoundary>
          <div className="flex flex-col xl:flex-row gap-4 lg:gap-8">
            <section className="xl:w-2/3">
              <div className="sticky top-4 xl:top-6">
                <ClientOnlySalesForm />
              </div>
            </section>
            
            <section className="xl:w-1/3 space-y-4 lg:space-y-6" style={{ zIndex: 1, position: 'relative', overflow: 'visible' }}>
              <div className="bg-white rounded-lg shadow-sm">
                <DailyStats />
              </div>
              
              <div className="bg-white rounded-lg shadow-sm">
                <SalesDashboard />
              </div>
            </section>
          </div>
        </SalesErrorBoundary>
      </div>
    </main>
  );
}