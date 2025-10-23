'use client';

import React, { useState } from 'react';
import HomeButton from '@/app/components/ui/HomeButtom';
import dynamic from 'next/dynamic';
import { SalesDashboard } from '@/app/ventas/components/SalesDashboard';
import DailyStats from '@/app/ventas/components/DailyStats';
import SalesErrorBoundary from '@/app/ventas/components/SalesErrorBoundary';
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
              {/* Add Order Button - Enhanced Design */}
              {!showOrderForm && (
                <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 rounded-xl shadow-2xl p-8 text-center group hover:shadow-3xl transition-all duration-300">
                  {/* Animated background effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                  
                  <div className="relative z-10">
                    <div className="mb-3">
                      <span className="text-4xl">🎯</span>
                    </div>
                    <h3 className="text-white text-xl font-bold mb-2">¿Listo para una nueva venta?</h3>
                    <p className="text-blue-100 text-sm mb-6">Crea una orden y sigue aumentando tus ventas</p>
                    
                    <Button
                      onClick={() => setShowOrderForm(true)}
                      size="lg"
                      className="bg-white text-blue-600 hover:bg-blue-50 font-bold text-lg px-10 py-6 shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-200 rounded-lg"
                    >
                      <span className="text-2xl mr-3">➕</span>
                      Agregar Nueva Orden
                    </Button>
                  </div>
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
      </div>
    </main>
  );
}