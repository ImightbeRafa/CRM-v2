// src/app/produccion/components/GuiaGenerator.tsx
import React, { useState, useEffect } from 'react';
import { Sale } from '../types/sales';
import { Button } from "@/app/components/ui/button";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  FileText,
  Clock,
  RefreshCw
} from 'lucide-react';

interface GuiaGeneratorProps {
  open: boolean;
  orders: Sale[];
  onClose: () => void;
  onUpdateOrder: (orderId: string, updatedData: Partial<Sale>) => Promise<Sale>;
}

interface GuiaStatus {
  id: string;
  orderId: string;
  carrier: string;
  guiaNumber: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: string | null;
  errorMessage: string | null;
  hasPdf: boolean;
  pdfFileName: string | null;
  createdAt: string;
  updatedAt: string;
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
  email?: string | null;
  password?: string | null;
  requiresSetup?: boolean;
}

export function GuiaGenerator({ orders, open, onClose, onUpdateOrder }: GuiaGeneratorProps) {
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');
  const [orderGuias, setOrderGuias] = useState<OrderGuiaData[]>([]);
  const [shippingConfigs, setShippingConfigs] = useState<ShippingConfig[]>([]);
  const [requiresShippingSetup, setRequiresShippingSetup] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<'manual' | 'automatic'>('manual');
  const [deliveryType, setDeliveryType] = useState<'Domicilio' | 'Sucursal' | 'Punto de correo'>('Domicilio');
  const [guiasHistory, setGuiasHistory] = useState<GuiaStatus[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Only process orders when dialog opens
  useEffect(() => {
    if (open) {
      // Filter and map orders only when opening
      const eaOrders = orders
        .filter(order => order.orderType === 'EA')
        .map(order => ({
          orderId: order.orderId,
          guiaNumber: '',
          selected: false,
          status: 'pending' as const,
        }));
      setOrderGuias(eaOrders);
      loadShippingConfigs();
    }
  }, [open, orders]);

  const handleCarrierChange = (carrierValue: string) => {
    setSelectedCarrier(carrierValue);
    const config = shippingConfigs.find(cfg => cfg.carrier === carrierValue);
    if (config) {
      setRequiresShippingSetup(!!config.requiresSetup && !(config.password === '***'));
    } else {
      setRequiresShippingSetup(false);
    }
  };

  const loadShippingConfigs = async () => {
    try {
      const response = await fetch('/api/config/shipping-config', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        if (response.status === 403) {
          console.warn('Access denied to shipping configs. Using default configuration.');
          // Set a default config for manual mode
          setShippingConfigs([{
            id: 'default',
            carrier: 'correos',
            name: 'Correos de Costa Rica',
            isActive: true,
            isDefault: true
          }]);
          setSelectedCarrier('correos');
          return;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'success') {
        const configs: ShippingConfig[] = (result.data || []).map((config: ShippingConfig) => ({
          ...config,
          requiresSetup: !config.email || (!config.password || config.password === '')
        }));

        if (configs.length === 0) {
          // Fallback when API returns success but no configs
          const defaultCorreosConfig: ShippingConfig = {
            id: 'default',
            carrier: 'correos',
            name: 'Correos de Costa Rica',
            isActive: true,
            isDefault: true,
            requiresSetup: true
          };
          setShippingConfigs([defaultCorreosConfig]);
          setSelectedCarrier(defaultCorreosConfig.carrier);
          setRequiresShippingSetup(true);
          return;
        }

        setShippingConfigs(configs);
        const defaultConfig = configs.find((config: ShippingConfig) => config.isDefault)
          || configs[0];
        if (defaultConfig) {
          setSelectedCarrier(defaultConfig.carrier);
          setRequiresShippingSetup(!!defaultConfig.requiresSetup && !(defaultConfig.password === '***'));
        }
      } else {
        throw new Error(result.error || 'Failed to load shipping configs');
      }
    } catch (error) {
      console.error('Error loading shipping configs:', error);
      // Fallback to default config
      setShippingConfigs([{
        id: 'default',
        carrier: 'correos',
        name: 'Correos de Costa Rica',
        isActive: true,
        isDefault: true
      }]);
      setSelectedCarrier('correos');
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

    if (requiresShippingSetup) {
      alert('Configura las credenciales de Correos de Costa Rica antes de generar guías automáticamente.');
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
          carrier: selectedCarrier,
          deliveryType: deliveryType
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
            <span class="info-label">Distrito:</span>
            <span class="info-value">${order.orderType === 'EA' ? (order.district || 'N/A') : 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Dirección:</span>
            <span class="info-value">${order.address}</span>
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

  // Load guías history when History tab is active
  const loadGuiasHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch('/api/shipping/guias/status', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setGuiasHistory(data.data.guias || []);
      }
    } catch (error) {
      console.error('Error loading guías history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Load history when dialog opens and History tab is selected
  useEffect(() => {
    if (open && activeTab === 'history') {
      loadGuiasHistory();
    }
  }, [open, activeTab]);

  const downloadPDF = async (guiaId: string, fileName: string) => {
    try {
      const response = await fetch(`/api/shipping/guias/download/${guiaId}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error downloading PDF:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[95vh] sm:max-h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Truck className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="truncate">Guías de Envío</span>
          </DialogTitle>
        </DialogHeader>

        {/* Tabs for Generate and History */}
        <div className="px-4 sm:px-6">
          <div className="flex gap-2 border-b">
            <button
              onClick={() => setActiveTab('generate')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'generate'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <FileText className="inline h-4 w-4 mr-2" />
              Generar
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'history'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Download className="inline h-4 w-4 mr-2" />
              Historial ({guiasHistory.length})
            </button>
          </div>
        </div>

        {activeTab === 'generate' ? (
          <>
            <div className="px-4 sm:px-6 py-2">
              <p className="text-sm text-gray-600">
                {generationMode === 'manual' 
                  ? 'Ingrese manualmente los números de guía de Betsy para las órdenes seleccionadas.'
                  : 'Genere guías automáticamente con Correos de Costa Rica usando el sistema de automatización.'}
              </p>
            </div>
            {/* Generation Mode Selection */}
        <div className="px-4 sm:px-6 py-3 border-b bg-gray-50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="manual"
                name="generationMode"
                value="manual"
                checked={generationMode === 'manual'}
                onChange={(e) => setGenerationMode(e.target.value as 'manual' | 'automatic')}
                className="w-4 h-4"
              />
              <label htmlFor="manual" className="text-sm sm:text-base cursor-pointer">Manual</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="automatic"
                name="generationMode"
                value="automatic"
                checked={generationMode === 'automatic'}
                onChange={(e) => setGenerationMode(e.target.value as 'manual' | 'automatic')}
                className="w-4 h-4"
              />
              <label htmlFor="automatic" className="text-sm sm:text-base cursor-pointer">
                <span className="hidden sm:inline">Automático (Correos de Costa Rica)</span>
                <span className="sm:hidden">Automático</span>
              </label>
            </div>
          </div>
        </div>

        {/* Carrier Selection for Automatic Mode */}
        {generationMode === 'automatic' && (
          <div className="px-4 sm:px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Empresa de Envío:</label>
                <select
                  value={selectedCarrier}
                  onChange={(e) => handleCarrierChange(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 border border-blue-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Seleccionar empresa</option>
                  {shippingConfigs.map(config => (
                    <option key={config.id} value={config.carrier}>
                      {config.name}
                    </option>
                  ))}
                </select>
                {requiresShippingSetup && (
                  <p className="text-xs text-red-600 sm:ml-4">
                    Configura el usuario y contraseña de Correos en Configuración &gt; Envíos.
                  </p>
                )}
              </div>
              
              {/* Delivery Type Selection for Correos */}
              {(selectedCarrier === 'correos_cr' || selectedCarrier === 'correos' || selectedCarrier.toLowerCase().includes('correo')) && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 pt-2 border-t border-blue-200">
                  <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Tipo de Envío:</label>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="deliveryType"
                        value="Domicilio"
                        checked={deliveryType === 'Domicilio'}
                        onChange={(e) => setDeliveryType(e.target.value as any)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm">Domicilio</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="deliveryType"
                        value="Sucursal"
                        checked={deliveryType === 'Sucursal'}
                        onChange={(e) => setDeliveryType(e.target.value as any)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm">Sucursal</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="deliveryType"
                        value="Punto de correo"
                        checked={deliveryType === 'Punto de correo'}
                        onChange={(e) => setDeliveryType(e.target.value as any)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm">Punto de correo</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Make only the list scrollable and keep footer visible */}
        <div className="flex-1 overflow-hidden flex flex-col">
        <ScrollArea className="max-h-[50vh] sm:max-h-[55vh] px-4 sm:px-6">
          <div className="space-y-3 py-2">
            {orderGuias.map((og) => {
              const order = orders.find(o => o.orderId === og.orderId);
              if (!order) return null;

              return (
                <div key={og.orderId} className="flex items-start sm:items-center gap-3 p-3 sm:p-4 border rounded-lg bg-white shadow-sm">
                  <div className="pt-1 sm:pt-0">
                    <Checkbox
                      checked={og.selected}
                      onCheckedChange={() => handleToggleOrder(og.orderId)}
                      disabled={og.status === 'generating'}
                      className="w-5 h-5"
                    />
                  </div>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm sm:text-base">Orden: {og.orderId}</p>
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
                      <p className="text-xs sm:text-sm text-gray-600 mt-1 truncate">{order.customerName}</p>
                      <p className="text-xs sm:text-sm text-gray-500 truncate">
                        {order.orderType === 'EA' ? `${order.province}, ${order.canton}` : 'N/A'}
                      </p>
                      <p className="text-xs sm:text-sm text-gray-500">Cantidad: {order.quantity}</p>
                      {og.error && (
                        <p className="text-xs text-red-500 mt-1 break-words">{og.error}</p>
                      )}
                    </div>
                    <div className="space-y-2 mt-2 sm:mt-0">
                      <Input
                        placeholder="Número de guía"
                        value={og.guiaNumber}
                        onChange={(e) => handleGuiaNumberChange(og.orderId, e.target.value)}
                        disabled={!og.selected || og.status === 'generating'}
                        className="text-sm h-9 sm:h-10"
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
        <DialogFooter className="px-4 sm:px-6 py-3 sm:py-4 border-t bg-gray-50 flex-col sm:flex-row gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="w-full sm:w-auto order-3 sm:order-1"
          >
            Cancelar
          </Button>
          
          {generationMode === 'automatic' && (
            <Button 
              onClick={handleAutomaticGeneration} 
              disabled={!canGenerateAutomatically}
              className="w-full sm:w-auto flex items-center justify-center gap-2 order-1 sm:order-2"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Generar Automáticamente</span>
              <span className="sm:hidden">Generar Auto</span>
            </Button>
          )}
          
          <Button 
            onClick={handlePrint} 
            disabled={!canPrint}
            className="w-full sm:w-auto flex items-center justify-center gap-2 order-2 sm:order-3"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Generar e Imprimir Seleccionados</span>
            <span className="sm:hidden">Imprimir</span>
          </Button>
        </DialogFooter>
        </div>
          </>
        ) : (
          /* History Tab */
          <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
            {loadingHistory ? (
              <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : guiasHistory.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">No hay guías generadas</p>
                <p className="text-sm mt-2">Las guías que generes aparecerán aquí</p>
              </div>
            ) : (
              <div className="space-y-3">
                {guiasHistory.map((guia) => (
                  <div
                    key={guia.id}
                    className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-white"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-lg">
                            {guia.guiaNumber || 'Sin número'}
                          </span>
                          <Badge
                            variant={
                              guia.status === 'completed'
                                ? 'default'
                                : guia.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                            }
                            className="text-xs"
                          >
                            {guia.status === 'completed' ? (
                              <CheckCircle className="inline h-3 w-3 mr-1" />
                            ) : guia.status === 'failed' ? (
                              <XCircle className="inline h-3 w-3 mr-1" />
                            ) : (
                              <Clock className="inline h-3 w-3 mr-1" />
                            )}
                            {guia.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <p>
                            <strong>Orden:</strong> {guia.orderId}
                          </p>
                          <p>
                            <strong>Carrier:</strong> {guia.carrier}
                          </p>
                          {guia.progress && (
                            <p className="text-xs text-gray-500">{guia.progress}</p>
                          )}
                          {guia.errorMessage && (
                            <p className="text-xs text-red-600">{guia.errorMessage}</p>
                          )}
                          <p className="text-xs text-gray-400">
                            Creado: {new Date(guia.createdAt).toLocaleString('es-CR')}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {guia.hasPdf ? (
                          <Button
                            onClick={() => downloadPDF(guia.id, guia.pdfFileName || `guia-${guia.guiaNumber}.pdf`)}
                            size="sm"
                            className="flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" />
                            PDF
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled
                            className="flex items-center gap-2"
                          >
                            <XCircle className="h-4 w-4" />
                            Sin PDF
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-between items-center">
              <p className="text-sm text-gray-600">
                Total: {guiasHistory.length} guía(s)
              </p>
              <Button
                onClick={loadGuiasHistory}
                variant="outline"
                size="sm"
                disabled={loadingHistory}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loadingHistory ? 'animate-spin' : ''}`} />
                Actualizar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}