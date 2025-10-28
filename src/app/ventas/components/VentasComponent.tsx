'use client';

import React, { useState } from 'react';
import HomeButton from '@/app/components/ui/HomeButtom';
import dynamic from 'next/dynamic';
import { SalesDashboard } from '@/app/ventas/components/SalesDashboard';
import DailyStats from '@/app/ventas/components/DailyStats';
import SalesErrorBoundary from '@/app/ventas/components/SalesErrorBoundary';
import { DOMErrorBoundary } from '@/app/components/DOMErrorBoundary';
import { Button } from "@/app/components/ui/button";

// Dynamically import the EnhancedSalesForm with no SSR
const EnhancedSalesForm = dynamic(() => import('./EnhancedSalesForm'), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center py-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  )
});

export default function VentasContent() {
  const [showOrderForm, setShowOrderForm] = useState(false);

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-3">
          <HomeButton />
        </div>
      </nav>

      <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6" style={{ overflow: 'visible' }}>
        <DOMErrorBoundary>
          <SalesErrorBoundary>
            <div className="flex flex-col xl:flex-row gap-4 lg:gap-8 transition-all duration-300">
            {/* Form Section - Only shows when open */}
            {showOrderForm && (
              <section className="xl:w-2/3 transition-all duration-300">
                <div className="sticky top-4 xl:top-6">
                  <EnhancedSalesForm 
                    showOrderForm={showOrderForm}
                    onToggleForm={setShowOrderForm}
                  />
                </div>
              </section>
            )}
            
            {/* Dashboard Section - Full width when form is hidden */}
            <section className={`space-y-4 lg:space-y-6 transition-all duration-300 ${
              showOrderForm ? 'xl:w-1/3' : 'xl:flex-1'
            }`} style={{ zIndex: 1, position: 'relative', overflow: 'visible' }}>
              {/* Add Order Button - Apple-like Minimalistic Design */}
              {!showOrderForm && (
                <div className="bg-white rounded-2xl p-8 text-center hover:shadow-lg transition-all duration-300">
                  <div className="mb-6">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                      <span className="text-2xl">📝</span>
                    </div>
                  </div>
                  <h3 className="text-gray-900 text-xl font-medium mb-3">Nueva Venta</h3>
                  <p className="text-gray-500 text-base mb-8 max-w-sm mx-auto">Crea una orden y sigue aumentando tus ventas</p>
                  
                  <Button
                    onClick={() => setShowOrderForm(true)}
                    size="lg"
                    className="bg-gray-900 hover:bg-gray-800 text-white font-medium px-8 py-4 rounded-xl transition-all duration-200 hover:scale-105"
                  >
                    Agregar Orden
                  </Button>
                </div>
              )}
              
              <div className="bg-white rounded-lg shadow-sm">
                <DailyStats />
              </div>
              
              <div className="bg-white rounded-lg shadow-sm">
                <SalesDashboard />
              </div>
            </section>
            </div>
          </SalesErrorBoundary>
        </DOMErrorBoundary>
      </div>
    </main>
  );
}