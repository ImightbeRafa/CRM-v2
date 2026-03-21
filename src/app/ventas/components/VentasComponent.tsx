'use client';

import React, { useState, Suspense, lazy } from 'react';
import { AppShell } from '@/app/components/AppShell';
import { SalesDashboard } from '@/app/ventas/components/SalesDashboard';
import DailyStats from '@/app/ventas/components/DailyStats';
import SalesErrorBoundary from '@/app/ventas/components/SalesErrorBoundary';
import { DOMErrorBoundary } from '@/app/components/DOMErrorBoundary';
import { Button } from "@/app/components/ui/button";
import { Loader2, Plus } from 'lucide-react';

// Lazy load the form
const EnhancedSalesForm = lazy(() => import('./EnhancedSalesForm'));

// Loading skeleton component
function FormSkeleton() {
  return (
    <div className="bg-card rounded-lg shadow-md p-6 animate-pulse">
      <div className="h-8 bg-muted rounded w-1/3 mb-6"></div>
      <div className="space-y-4">
        <div className="h-10 bg-muted rounded"></div>
        <div className="h-10 bg-muted rounded"></div>
        <div className="h-10 bg-muted rounded"></div>
        <div className="h-32 bg-muted rounded"></div>
      </div>
      <div className="mt-6 flex items-center gap-2 text-blue-600 dark:text-blue-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando formulario...</span>
      </div>
    </div>
  );
}

export default function VentasContent() {
  const [showOrderForm, setShowOrderForm] = useState(false);

  return (
    <AppShell>
      <div className="w-full px-2 sm:px-3 md:px-4 py-3 sm:py-4" style={{ overflow: 'visible' }}>
        <DOMErrorBoundary>
          <SalesErrorBoundary>
            <div className="flex flex-col xl:flex-row gap-4 lg:gap-8 transition-all duration-300">
            {/* Form Section - Only shows when open */}
            {showOrderForm && (
              <section className="xl:w-2/3 transition-all duration-300">
                <div className="sticky top-4 xl:top-6">
                  <Suspense fallback={<FormSkeleton />}>
                    <EnhancedSalesForm 
                      showOrderForm={showOrderForm}
                      onToggleForm={setShowOrderForm}
                    />
                  </Suspense>
                </div>
              </section>
            )}
            
            {/* Dashboard Section - Full width when form is hidden */}
            <section className={`space-y-4 lg:space-y-6 transition-all duration-300 ${
              showOrderForm ? 'xl:w-1/3' : 'xl:flex-1'
            }`} style={{ zIndex: 1, position: 'relative', overflow: 'visible' }}>
              {/* Add Order Button - Apple-like Minimalistic Design */}
              {!showOrderForm && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => setShowOrderForm(true)}
                    size="icon"
                    aria-label="Agregar orden"
                    className="w-12 h-12 rounded-2xl bg-black text-white shadow-lg hover:bg-black/80 transition-transform duration-150 hover:scale-105"
                  >
                    <Plus className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </div>
              )}
              
              <div className="bg-card rounded-lg shadow-sm">
                <DailyStats />
              </div>
              
              <div className="bg-card rounded-lg shadow-sm">
                <SalesDashboard />
              </div>
            </section>
            </div>
          </SalesErrorBoundary>
        </DOMErrorBoundary>
      </div>
    </AppShell>
  );
}