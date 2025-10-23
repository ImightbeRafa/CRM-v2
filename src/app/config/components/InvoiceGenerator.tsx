'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { 
  FileText, 
  Download, 
  Mail, 
  Plus,
  Trash2,
  Check,
  X,
  Calendar,
  DollarSign,
  User,
  Package,
  Printer
} from 'lucide-react';

interface Order {
  id: string;
  orderId: string;
  customerName: string;
  email?: string;
  phone?: string;
  address?: string;
  product?: string;
  quantity?: number;
  total: number;
  timestamp: string;
}

interface InvoiceGeneratorProps {
  orders?: Order[];
  isOpen: boolean;
  onClose: () => void;
  onInvoiceGenerated?: (invoiceIds: string[]) => void;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceFormData {
  orderId?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  customerIdNumber: string;
  items: LineItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  discount: number;
  total: number;
  notes: string;
  dueDate: string;
  paymentMethod: string;
}

export function InvoiceGenerator({ 
  orders = [], 
  isOpen, 
  onClose, 
  onInvoiceGenerated 
}: InvoiceGeneratorProps) {
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [generationMode, setGenerationMode] = useState<'single' | 'bulk'>('single');
  const [currentInvoice, setCurrentInvoice] = useState<InvoiceFormData>({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    customerAddress: '',
    customerIdNumber: '',
    items: [],
    subtotal: 0,
    taxRate: 13, // Default IVA in Costa Rica
    tax: 0,
    discount: 0,
    total: 0,
    notes: '',
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
    paymentMethod: 'pending'
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [generatedInvoices, setGeneratedInvoices] = useState<any[]>([]);

  useEffect(() => {
    if (selectedOrders.length === 1 && orders.length > 0) {
      const order = orders.find(o => o.id === selectedOrders[0]);
      if (order) {
        loadOrderData(order);
      }
    }
  }, [selectedOrders]);

  const loadOrderData = (order: Order) => {
    const items: LineItem[] = [];
    
    if (order.product && order.quantity) {
      items.push({
        description: order.product,
        quantity: order.quantity,
        unitPrice: order.total / order.quantity,
        total: order.total
      });
    } else {
      items.push({
        description: 'Orden #' + order.orderId,
        quantity: 1,
        unitPrice: order.total,
        total: order.total
      });
    }

    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const tax = subtotal * (currentInvoice.taxRate / 100);
    const total = subtotal + tax - currentInvoice.discount;

    setCurrentInvoice({
      ...currentInvoice,
      orderId: order.id,
      customerName: order.customerName,
      customerEmail: order.email || '',
      customerPhone: order.phone || '',
      customerAddress: order.address || '',
      items,
      subtotal,
      tax,
      total
    });
  };

  const handleToggleOrder = (orderId: string) => {
    setSelectedOrders(prev => 
      prev.includes(orderId)
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const handleSelectAll = () => {
    if (selectedOrders.length === orders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(orders.map(o => o.id));
    }
  };

  const addLineItem = () => {
    setCurrentInvoice(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          description: '',
          quantity: 1,
          unitPrice: 0,
          total: 0
        }
      ]
    }));
  };

  const removeLineItem = (index: number) => {
    setCurrentInvoice(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
    recalculateTotals();
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: any) => {
    setCurrentInvoice(prev => {
      const newItems = [...prev.items];
      newItems[index] = {
        ...newItems[index],
        [field]: value
      };
      
      // Recalculate total for this item
      if (field === 'quantity' || field === 'unitPrice') {
        newItems[index].total = newItems[index].quantity * newItems[index].unitPrice;
      }
      
      return {
        ...prev,
        items: newItems
      };
    });
    
    // Recalculate invoice totals
    setTimeout(recalculateTotals, 0);
  };

  const recalculateTotals = () => {
    setCurrentInvoice(prev => {
      const subtotal = prev.items.reduce((sum, item) => sum + item.total, 0);
      const tax = subtotal * (prev.taxRate / 100);
      const total = subtotal + tax - prev.discount;
      
      return {
        ...prev,
        subtotal,
        tax,
        total
      };
    });
  };

  const handleGenerateSingle = async () => {
    if (!validateInvoice()) {
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentInvoice)
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        setGeneratedInvoices([result.data]);
        alert('✅ Factura generada exitosamente!');
        if (onInvoiceGenerated) {
          onInvoiceGenerated([result.data.id]);
        }
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error generating invoice:', error);
      alert('❌ Error al generar factura');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateBulk = async () => {
    if (selectedOrders.length === 0) {
      alert('⚠️ Selecciona al menos una orden');
      return;
    }

    setIsGenerating(true);
    try {
      const invoices = selectedOrders.map(orderId => {
        const order = orders.find(o => o.id === orderId);
        if (!order) return null;

        return {
          orderId: order.id,
          customerName: order.customerName,
          customerEmail: order.email || '',
          customerPhone: order.phone || '',
          customerAddress: order.address || '',
          customerIdNumber: '',
          items: [{
            description: order.product || `Orden #${order.orderId}`,
            quantity: order.quantity || 1,
            unitPrice: order.total / (order.quantity || 1),
            total: order.total
          }],
          subtotal: order.total,
          taxRate: 13,
          tax: order.total * 0.13,
          discount: 0,
          total: order.total * 1.13,
          notes: `Factura generada automáticamente para orden #${order.orderId}`,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          paymentMethod: 'pending'
        };
      }).filter(Boolean);

      const response = await fetch('/api/invoices/bulk-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoices })
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        setGeneratedInvoices(result.data);
        alert(`✅ ${result.data.length} facturas generadas exitosamente!`);
        if (onInvoiceGenerated) {
          onInvoiceGenerated(result.data.map((inv: any) => inv.id));
        }
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error generating invoices:', error);
      alert('❌ Error al generar facturas');
    } finally {
      setIsGenerating(false);
    }
  };

  const validateInvoice = (): boolean => {
    if (!currentInvoice.customerName.trim()) {
      alert('⚠️ El nombre del cliente es requerido');
      return false;
    }
    
    if (currentInvoice.items.length === 0) {
      alert('⚠️ Agrega al menos un artículo');
      return false;
    }
    
    if (currentInvoice.items.some(item => !item.description.trim() || item.quantity <= 0 || item.unitPrice < 0)) {
      alert('⚠️ Todos los artículos deben tener descripción, cantidad y precio válidos');
      return false;
    }
    
    return true;
  };

  const handleDownloadPDF = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${invoiceId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('❌ Error al descargar PDF');
    }
  };

  const handleEmailInvoice = async (invoiceId: string) => {
    const email = prompt('Email del destinatario:');
    if (!email) return;

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        alert('✅ Factura enviada por email!');
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error emailing invoice:', error);
      alert('❌ Error al enviar email');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: 'CRC',
      minimumFractionDigits: 0
    }).format(amount);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="max-w-5xl w-full my-8">
        <CardHeader className="bg-gradient-to-r from-purple-500 to-pink-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <FileText className="w-6 h-6" />
                Generador de Facturas
              </CardTitle>
              <CardDescription className="text-purple-100">
                Crea facturas profesionales para tus órdenes
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-white hover:bg-white hover:bg-opacity-20"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {/* Mode Selection */}
          <div className="flex gap-4 mb-6">
            <Button
              variant={generationMode === 'single' ? 'default' : 'outline'}
              onClick={() => setGenerationMode('single')}
              className="flex-1"
            >
              <FileText className="w-4 h-4 mr-2" />
              Factura Individual
            </Button>
            <Button
              variant={generationMode === 'bulk' ? 'default' : 'outline'}
              onClick={() => setGenerationMode('bulk')}
              className="flex-1"
            >
              <Package className="w-4 h-4 mr-2" />
              Generación Masiva
            </Button>
          </div>

          {/* Order Selection */}
          {orders.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Seleccionar Órdenes</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                  >
                    {selectedOrders.length === orders.length ? 'Deseleccionar Todas' : 'Seleccionar Todas'}
                  </Button>
                </div>
                <CardDescription>
                  {selectedOrders.length} de {orders.length} órdenes seleccionadas
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-64 overflow-y-auto">
                <div className="space-y-2">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedOrders.includes(order.id)
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => handleToggleOrder(order.id)}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedOrders.includes(order.id)}
                          onChange={() => handleToggleOrder(order.id)}
                          className="rounded border-gray-300"
                        />
                        <div>
                          <div className="font-medium text-gray-900">
                            Orden #{order.orderId}
                          </div>
                          <div className="text-sm text-gray-500">
                            {order.customerName} • {formatCurrency(order.total)}
                          </div>
                        </div>
                      </div>
                      {selectedOrders.includes(order.id) && (
                        <Check className="w-5 h-5 text-purple-600" />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Single Invoice Form */}
          {generationMode === 'single' && (
            <div className="space-y-6">
              {/* Customer Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Información del Cliente
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre del Cliente <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={currentInvoice.customerName}
                      onChange={(e) => setCurrentInvoice(prev => ({ ...prev, customerName: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded-md"
                      placeholder="Juan Pérez"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={currentInvoice.customerEmail}
                      onChange={(e) => setCurrentInvoice(prev => ({ ...prev, customerEmail: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded-md"
                      placeholder="juan@example.com"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                    <input
                      type="tel"
                      value={currentInvoice.customerPhone}
                      onChange={(e) => setCurrentInvoice(prev => ({ ...prev, customerPhone: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded-md"
                      placeholder="8888-9999"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cédula/ID</label>
                    <input
                      type="text"
                      value={currentInvoice.customerIdNumber}
                      onChange={(e) => setCurrentInvoice(prev => ({ ...prev, customerIdNumber: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded-md"
                      placeholder="1-1234-5678"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha de Vencimiento
                    </label>
                    <input
                      type="date"
                      value={currentInvoice.dueDate}
                      onChange={(e) => setCurrentInvoice(prev => ({ ...prev, dueDate: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
                    <textarea
                      value={currentInvoice.customerAddress}
                      onChange={(e) => setCurrentInvoice(prev => ({ ...prev, customerAddress: e.target.value }))}
                      className="w-full p-2 border border-gray-300 rounded-md"
                      rows={2}
                      placeholder="Dirección completa del cliente"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Line Items */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Package className="w-5 h-5" />
                      Artículos
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addLineItem}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Agregar Artículo
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {currentInvoice.items.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Package className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p>No hay artículos. Agrega al menos uno.</p>
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={addLineItem}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Agregar Primer Artículo
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {currentInvoice.items.map((item, index) => (
                        <div key={index} className="grid grid-cols-12 gap-2 items-center p-3 bg-gray-50 rounded-lg">
                          <div className="col-span-5">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                              placeholder="Descripción del artículo"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(index, 'quantity', parseInt(e.target.value) || 0)}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                              placeholder="Cant."
                              min="1"
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => updateLineItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="w-full p-2 border border-gray-300 rounded-md text-sm"
                              placeholder="Precio"
                              min="0"
                              step="0.01"
                            />
                          </div>
                          <div className="col-span-2 text-right font-semibold text-gray-900">
                            {formatCurrency(item.total)}
                          </div>
                          <div className="col-span-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLineItem(index)}
                              className="text-red-600 hover:text-red-800 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Totals */}
                  {currentInvoice.items.length > 0 && (
                    <div className="mt-6 border-t pt-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-700">Subtotal:</span>
                        <span className="font-semibold text-gray-900">
                          {formatCurrency(currentInvoice.subtotal)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-700">IVA:</span>
                          <input
                            type="number"
                            value={currentInvoice.taxRate}
                            onChange={(e) => {
                              setCurrentInvoice(prev => ({ ...prev, taxRate: parseFloat(e.target.value) || 0 }));
                              setTimeout(recalculateTotals, 0);
                            }}
                            className="w-20 p-1 border border-gray-300 rounded text-sm"
                            min="0"
                            max="100"
                            step="0.1"
                          />
                          <span className="text-gray-700">%</span>
                        </div>
                        <span className="font-semibold text-gray-900">
                          {formatCurrency(currentInvoice.tax)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-700">Descuento:</span>
                          <input
                            type="number"
                            value={currentInvoice.discount}
                            onChange={(e) => {
                              setCurrentInvoice(prev => ({ ...prev, discount: parseFloat(e.target.value) || 0 }));
                              setTimeout(recalculateTotals, 0);
                            }}
                            className="w-32 p-1 border border-gray-300 rounded text-sm"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                          />
                        </div>
                        <span className="font-semibold text-red-600">
                          -{formatCurrency(currentInvoice.discount)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300">
                        <span className="text-lg font-bold text-gray-900">TOTAL:</span>
                        <span className="text-2xl font-bold text-purple-600">
                          {formatCurrency(currentInvoice.total)}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Notas Adicionales</CardTitle>
                </CardHeader>
                <CardContent>
                  <textarea
                    value={currentInvoice.notes}
                    onChange={(e) => setCurrentInvoice(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full p-2 border border-gray-300 rounded-md"
                    rows={3}
                    placeholder="Notas, términos y condiciones, instrucciones de pago..."
                  />
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={onClose}
                >
                  Cancelar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowPreview(true)}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Vista Previa
                </Button>
                <Button
                  onClick={handleGenerateSingle}
                  disabled={isGenerating}
                  className="bg-gradient-to-r from-purple-500 to-pink-600"
                >
                  {isGenerating ? 'Generando...' : 'Generar Factura'}
                </Button>
              </div>
            </div>
          )}

          {/* Bulk Generation */}
          {generationMode === 'bulk' && (
            <div className="space-y-6">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Package className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-blue-900 mb-1">
                        Generación Masiva de Facturas
                      </h4>
                      <p className="text-sm text-blue-700">
                        Se generarán {selectedOrders.length} facturas automáticamente basadas en los datos
                        de las órdenes seleccionadas. Cada factura incluirá IVA del 13% y fecha de vencimiento
                        de 30 días.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={onClose}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleGenerateBulk}
                  disabled={isGenerating || selectedOrders.length === 0}
                  className="bg-gradient-to-r from-purple-500 to-pink-600"
                >
                  {isGenerating 
                    ? `Generando ${selectedOrders.length} facturas...`
                    : `Generar ${selectedOrders.length} Facturas`
                  }
                </Button>
              </div>
            </div>
          )}

          {/* Generated Invoices */}
          {generatedInvoices.length > 0 && (
            <Card className="mt-6 bg-green-50 border-green-200">
              <CardHeader>
                <CardTitle className="text-green-900">
                  ✅ Facturas Generadas Exitosamente
                </CardTitle>
                <CardDescription>
                  {generatedInvoices.length} factura(s) creadas
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {generatedInvoices.map((invoice) => (
                    <div 
                      key={invoice.id}
                      className="flex items-center justify-between p-3 bg-white rounded-lg border border-green-200"
                    >
                      <div>
                        <div className="font-medium text-gray-900">
                          {invoice.invoiceNumber}
                        </div>
                        <div className="text-sm text-gray-500">
                          {invoice.customerName} • {formatCurrency(invoice.total)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadPDF(invoice.id)}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          PDF
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEmailInvoice(invoice.id)}
                        >
                          <Mail className="w-4 h-4 mr-1" />
                          Email
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

