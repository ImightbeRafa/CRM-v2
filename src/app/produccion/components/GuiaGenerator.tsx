// src/app/produccion/components/GuiaGenerator.tsx
import React, { useState, useEffect } from 'react';
import { Sale } from '../types/sales';
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Checkbox } from "@/app/components/ui/checkbox";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Badge } from "@/app/components/ui/badge";
import { 
  Truck, 
  Download, 
  CheckCircle, 
  XCircle, 
  Loader2,
  Globe,
  Settings,
  FileText
} from 'lucide-react';

interface GuiaGeneratorProps {
  orders: Sale[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateOrder: (orderId: string, updatedData: Partial<Sale>) => Promise<Sale>;
}

interface OrderGuiaData {
  orderId: string;
  guiaNumber: string;
  selected: boolean;
  status?: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
  trackingNumber?: string;
  pdfDownloaded?: boolean;
}

interface ShippingConfig {
  id: string;
  carrier: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
}

export function GuiaGenerator({ orders, isOpen, onClose, onUpdateOrder }: GuiaGeneratorProps) {
  const [orderGuias, setOrderGuias] = useState<OrderGuiaData[]>(
    orders
      .filter(order => order.orderType === 'EA')
      .map(order => ({
        orderId: order.orderId,
        guiaNumber: '',
        selected: false,
        status: 'pending' as const,
      }))
  );

  const [shippingConfigs, setShippingConfigs] = useState<ShippingConfig[]>([]);
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<'manual' | 'automatic'>('manual');

  useEffect(() => {
    if (isOpen) {
      loadShippingConfigs();
    }
  }, [isOpen]);

  const loadShippingConfigs = async () => {
    try {
      const response = await fetch('/api/config/shipping-config', {
        credentials: 'include'
      });
      const result = await response.json();
      
      if (result.status === 'success') {
        setShippingConfigs(result.data);
        const defaultConfig = result.data.find((config: ShippingConfig) => config.isDefault);
        if (defaultConfig) {
          setSelectedCarrier(defaultConfig.carrier);
        }
      }
    } catch (error) {
      console.error('Error loading shipping configs:', error);
    }
  };

  const handleToggleOrder = (orderId: string) => {
    setOrderGuias(prev =>
      prev.map(og =>
        og.orderId === orderId
          ? { ...og, selected: !og.selected }
          : og
      )
    );
  };

  const handleGuiaNumberChange = (orderId: string, value: string) => {
    setOrderGuias(prev =>
      prev.map(og =>
        og.orderId === orderId
          ? { ...og, guiaNumber: value }
          : og
      )
    );
  };

  const handleAutomaticGeneration = async () => {
    const selectedOrders = orderGuias.filter(og => og.selected);
    
    if (selectedOrders.length === 0) {
      alert('Seleccione al menos una orden para generar guías automáticamente');
      return;
    }

    if (!selectedCarrier) {
      alert('Seleccione una empresa de envío');
      return;
    }

    setIsGenerating(true);

    // Update status to generating
    setOrderGuias(prev =>
      prev.map(og =>
        og.selected
          ? { ...og, status: 'generating' as const }
          : og
      )
    );

    try {
      const response = await fetch('/api/shipping/generate-guia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderIds: selectedOrders.map(og => og.orderId),
          carrier: selectedCarrier
        })
      });

      const result = await response.json();

      if (result.status === 'success') {
        // Update order guías with results
        setOrderGuias(prev =>
          prev.map(og => {
            const orderResult = result.data.results.find((r: any) => r.orderId === og.orderId);
            if (orderResult) {
              return {
                ...og,
                status: orderResult.success ? 'success' as const : 'error' as const,
                guiaNumber: orderResult.guiaNumber || og.guiaNumber,
                trackingNumber: orderResult.trackingNumber,
                error: orderResult.error,
                pdfDownloaded: orderResult.pdfDownloaded || false
              };
            }
            return og;
          })
        );

        // Update orders in the parent component - use status update instead of full order update
        for (const orderResult of result.data.results) {
          if (orderResult.success) {
            // Update status to 'Enviado'
            try {
              const statusResponse = await fetch('/api/orders/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  orderId: orderResult.orderId,
                  status: 'Enviado'
                })
              });
              
              if (statusResponse.ok) {
                console.log(`Status updated to 'Enviado' for order ${orderResult.orderId}`);
              }
            } catch (error) {
              console.error(`Failed to update status for order ${orderResult.orderId}:`, error);
            }
          }
        }

        const pdfsDownloaded = result.data.pdfsDownloaded || 0;
        alert(`Guías generadas: ${result.data.successful} exitosas, ${result.data.failed} fallidas. PDFs descargados: ${pdfsDownloaded}`);
      } else {
        throw new Error(result.error || 'Error generando guías');
      }
    } catch (error) {
      console.error('Error generating guías:', error);
      alert('Error al generar guías automáticamente');
      
      // Reset status to pending
      setOrderGuias(prev =>
        prev.map(og =>
          og.status === 'generating'
            ? { ...og, status: 'pending' as const }
            : og
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    const selectedOrders = orderGuias.filter(og => og.selected);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const orderElements = selectedOrders.map(og => {
      const order = orders.find(o => o.orderId === og.orderId);
      if (!order) return '';

      return `
        <div class="guia-container page-break">
          <div class="header">
            <h1>Guía de Envío</h1>
            <h2>Número de Guía: ${og.guiaNumber}</h2>
          </div>
          <div class="info-row">
            <span class="info-label">Orden:</span>
            <span class="info-value">${order.orderId}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Teléfono:</span>
            <span class="info-value">${order.phone}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Cliente:</span>
            <span class="info-value">${order.customerName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Producto:</span>
            <span class="info-value">${order.product}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Cantidad:</span>
            <span class="info-value">${order.quantity}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Provincia:</span>
            <span class="info-value">${order.orderType === 'EA' ? order.province : 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Cantón:</span>
            <span class="info-value">${order.orderType === 'EA' ? order.canton : 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Dirección:</span>
            <span class="info-value">${order.address}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Negocio:</span>
            <span class="info-value">${order.business}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Comentarios:</span>
            <span class="info-value">${order.comments}</span>
          </div>
        </div>
      `;
    }).join('');

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Guías de Envío</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
              margin: 0;
            }
            .guia-container {
              border: 2px solid #000;
              padding: 20px;
              margin-bottom: 20px;
              page-break-inside: avoid;
            }
            .header {
              text-align: center;
              margin-bottom: 20px;
              border-bottom: 2px solid #000;
              padding-bottom: 10px;
            }
            .info-row {
              margin: 10px 0;
              display: flex;
              justify-content: space-between;
            }
            .info-label {
              font-weight: bold;
              margin-right: 10px;
            }
            .info-value {
              flex: 1;
            }
            .page-break {
              page-break-after: always;
            }
            @media print {
              body {
                padding: 0;
              }
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          ${orderElements}
          <button class="no-print" onclick="window.print()">Imprimir</button>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  const canPrint = orderGuias.some(og => og.selected && og.guiaNumber);
  const canGenerateAutomatically = orderGuias.some(og => og.selected) && selectedCarrier && !isGenerating;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Generar Guías de Envío
          </DialogTitle>
        </DialogHeader>
        {/* Generation Mode Selection */}
        <div className="px-4 py-2 border-b">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="manual"
                name="generationMode"
                value="manual"
                checked={generationMode === 'manual'}
                onChange={(e) => setGenerationMode(e.target.value as 'manual' | 'automatic')}
              />
              <label htmlFor="manual" className="text-sm">Manual</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="automatic"
                name="generationMode"
                value="automatic"
                checked={generationMode === 'automatic'}
                onChange={(e) => setGenerationMode(e.target.value as 'manual' | 'automatic')}
              />
              <label htmlFor="automatic" className="text-sm">Automático (Correos de Costa Rica)</label>
            </div>
          </div>
        </div>

        {/* Carrier Selection for Automatic Mode */}
        {generationMode === 'automatic' && (
          <div className="px-4 py-2 border-b">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium">Empresa de Envío:</label>
              <select
                value={selectedCarrier}
                onChange={(e) => setSelectedCarrier(e.target.value)}
                className="px-3 py-1 border rounded-md text-sm"
              >
                <option value="">Seleccionar empresa</option>
                {shippingConfigs.map(config => (
                  <option key={config.id} value={config.carrier}>
                    {config.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <ScrollArea className="max-h-[50vh] px-4">
          <div className="space-y-4">
            {orderGuias.map((og) => {
              const order = orders.find(o => o.orderId === og.orderId);
              if (!order) return null;

              return (
                <div key={og.orderId} className="flex items-center space-x-4 p-4 border rounded-lg">
                  <Checkbox
                    checked={og.selected}
                    onCheckedChange={() => handleToggleOrder(og.orderId)}
                    disabled={og.status === 'generating'}
                  />
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">Orden: {og.orderId}</p>
                        {og.status === 'generating' && (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        )}
                        {og.status === 'success' && (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                        {og.status === 'error' && (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{order.customerName}</p>
                      <p className="text-sm text-gray-500">
                        {order.orderType === 'EA' ? `${order.province}, ${order.canton}` : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500">Cantidad: {order.quantity}</p>
                      {og.error && (
                        <p className="text-xs text-red-500 mt-1">{og.error}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder="Número de guía"
                        value={og.guiaNumber}
                        onChange={(e) => handleGuiaNumberChange(og.orderId, e.target.value)}
                        disabled={!og.selected || og.status === 'generating'}
                      />
                      {og.trackingNumber && (
                        <div className="text-xs text-gray-600">
                          Tracking: {og.trackingNumber}
                        </div>
                      )}
                      {og.pdfDownloaded && (
                        <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
                          <FileText className="h-3 w-3" />
                          PDF Descargado
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4 flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          
          {generationMode === 'automatic' && (
            <Button 
              onClick={handleAutomaticGeneration} 
              disabled={!canGenerateAutomatically}
              className="flex items-center gap-2"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              Generar Automáticamente
            </Button>
          )}
          
          <Button onClick={handlePrint} disabled={!canPrint}>
            <Download className="h-4 w-4 mr-2" />
            Generar e Imprimir Seleccionados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}