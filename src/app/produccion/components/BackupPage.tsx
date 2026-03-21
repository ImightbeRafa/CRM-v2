// components/BackupPage.tsx
'use client';

import { useState } from 'react';

export default function BackupPage() {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportData = async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/orders');
      const data = await response.json();
      
      if (data.status === 'success') {
        const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sales-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Error al exportar datos');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-card rounded-lg shadow-sm mx-4 my-8 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="border-b border-border pb-4 mb-6">
          <h2 className="text-2xl font-semibold text-foreground">
            Gestión de Datos
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Exportar y gestionar datos de ventas
          </p>
        </div>
        
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">Exportar Datos</h3>
            <p className="text-sm text-blue-600 dark:text-blue-400 mb-3">
              Descarga todos los datos de ventas en formato JSON
            </p>
            <button
              onClick={handleExportData}
              disabled={isExporting}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? 'Exportando...' : 'Exportar Datos'}
            </button>
          </div>
          
          <div className="bg-muted border border-border rounded-lg p-4">
            <h3 className="font-semibold text-foreground mb-2">Información</h3>
            <p className="text-sm text-muted-foreground">
              Los datos se exportan en formato JSON y contienen toda la información de pedidos, clientes y productos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
