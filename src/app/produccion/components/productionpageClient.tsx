'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ProductionErrorBoundary } from './ProductionErrorBoundary';
import { AuroraShell } from '@/components/aurora/AuroraShell';
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav';
import { AuroraPageHeader } from '@/components/aurora/shell/AuroraPageHeader';
import { EnhancedProductionDashboard } from './EnhancedProductionDashboard';

const BackupPage = dynamic(() => import('./BackupPage'), { ssr: false });

export function ProductionPageClient() {
  const [isGuiaGeneratorOpen, setIsGuiaGeneratorOpen] = useState(false);
  const [isInvoiceGeneratorOpen, setIsInvoiceGeneratorOpen] = useState(false);

  return (
    <ProductionErrorBoundary>
      {/* Presentation only: aurora-light keeps the classic dashboard tokens light (no logic change). */}
      <AuroraShell fullBleed bottomNav={<AuroraMobileNav />}>
        <AuroraPageHeader title="Producción" subtitle="Preparación, guías de Correos y facturas de los pedidos" />
        <div className="aurora-light min-h-0 flex-1 overflow-y-auto bg-[var(--aurora-canvas)] text-slate-900" data-testid="produccion-aurora">
        <main className="w-full space-y-4 px-3 py-4 sm:px-6">
          <EnhancedProductionDashboard 
            onGenerateGuias={() => setIsGuiaGeneratorOpen(true)}
            isGuiaGeneratorOpen={isGuiaGeneratorOpen}
            onGuiaGeneratorClose={() => setIsGuiaGeneratorOpen(false)}
            onGenerateInvoices={() => setIsInvoiceGeneratorOpen(true)}
            isInvoiceGeneratorOpen={isInvoiceGeneratorOpen}
            onInvoiceGeneratorClose={() => setIsInvoiceGeneratorOpen(false)}
          />
          
          <div className="relative hidden md:block">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-border" />
            </div>
          </div>
          
          <BackupPage />
        </main>
        </div>
      </AuroraShell>
    </ProductionErrorBoundary>
  );
}