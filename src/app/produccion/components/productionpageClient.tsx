'use client';

import { useState } from 'react';
import BackupPage from './BackupPage';
import { EnhancedProductionDashboard } from './EnhancedProductionDashboard';
import { ProductionErrorBoundary } from './ProductionErrorBoundary';
import { AppShell } from '@/app/components/AppShell';

export function ProductionPageClient() {
  const [isGuiaGeneratorOpen, setIsGuiaGeneratorOpen] = useState(false);
  const [isInvoiceGeneratorOpen, setIsInvoiceGeneratorOpen] = useState(false);

  return (
    <ProductionErrorBoundary>
      <AppShell>
        <main className="w-full px-2 md:px-3 lg:px-4 py-2 md:py-3 space-y-4">
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
        
        <div className="h-16 md:h-20" />
      </AppShell>
    </ProductionErrorBoundary>
  );
}