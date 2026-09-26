'use client';

import React, { useState, Suspense, lazy } from 'react';
import { AuroraShell } from '@/components/aurora/AuroraShell';
import { PedidosBoard } from '@/app/ventas/components/PedidosBoard';
import SalesErrorBoundary from '@/app/ventas/components/SalesErrorBoundary';
import { DOMErrorBoundary } from '@/app/components/DOMErrorBoundary';
import { Loader2, Plus } from 'lucide-react';

// Lazy load the form
const EnhancedSalesForm = lazy(() => import('./EnhancedSalesForm'));

// Loading skeleton component
function FormSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 animate-pulse">
      <div className="h-8 bg-slate-100 rounded w-1/3 mb-6"></div>
      <div className="space-y-4">
        <div className="h-10 bg-slate-100 rounded"></div>
        <div className="h-10 bg-slate-100 rounded"></div>
        <div className="h-10 bg-slate-100 rounded"></div>
        <div className="h-32 bg-slate-100 rounded"></div>
      </div>
      <div className="mt-6 flex items-center gap-2 text-[#5B6CFF]">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando formulario...</span>
      </div>
    </div>
  );
}

export default function VentasContent() {
  const [showOrderForm, setShowOrderForm] = useState(false);

  return (
    <AuroraShell>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/70 bg-white px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-tight text-slate-900">Pedidos</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Ventas, pagos SINPE y envíos con Correos de Costa Rica
          </p>
        </div>
        {!showOrderForm && (
          <button
            type="button"
            onClick={() => setShowOrderForm(true)}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] px-4 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Crear pedido
          </button>
        )}
      </header>

      <div className="w-full space-y-4 px-4 py-4 sm:px-6">
        <DOMErrorBoundary>
          <SalesErrorBoundary>
            {/* Create-order form: same component and flow, stacked above the list while open */}
            {showOrderForm && (
              <section>
                <Suspense fallback={<FormSkeleton />}>
                  <EnhancedSalesForm
                    showOrderForm={showOrderForm}
                    onToggleForm={setShowOrderForm}
                  />
                </Suspense>
              </section>
            )}

            <PedidosBoard onCreate={() => setShowOrderForm(true)} />
          </SalesErrorBoundary>
        </DOMErrorBoundary>
      </div>
    </AuroraShell>
  );
}
