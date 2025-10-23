'use client';

import { useState } from 'react';
import BackupPage from './BackupPage';
import { EnhancedProductionDashboard } from './EnhancedProductionDashboard';
import HomeButton from '@/app/components/ui/HomeButtom';

export function ProductionPageClient() {
  const [isGuiaGeneratorOpen, setIsGuiaGeneratorOpen] = useState(false);
  const [isInvoiceGeneratorOpen, setIsInvoiceGeneratorOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3">
          <HomeButton />
        </div>
      </nav>
      
      <main className="container mx-auto px-4 md:px-6 lg:px-8 py-4 md:py-6 space-y-6 md:space-y-8">
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
            <div className="w-full border-t border-gray-200" />
          </div>
        </div>
        
        <BackupPage />
      </main>
      
      <div className="h-16 md:h-20" />
    </div>
  );
}