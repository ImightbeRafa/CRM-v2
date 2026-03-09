"use client";
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Badge } from "@/app/components/ui/badge";
import { Sale } from '../types/sales';
import { 
  Download, 
  FileText, 
  FileSpreadsheet, 
  Printer, 
  Mail,
  Calendar,
  Filter,
  Loader2
} from 'lucide-react';
import { useToast } from "@/app/hooks/use-toast";

function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Dynamic Status Filter Component for Export
const StatusFilterExport = ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => {
  const [statuses, setStatuses] = useState<Array<{key: string; label: string}>>([]);

  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status');
        const data = await response.json();
        if (data.status === 'success' && data.data.length > 0) {
          setStatuses(data.data);
        }
      } catch (error) {
        console.error('Error loading statuses:', error);
      }
    };
    loadStatuses();
  }, []);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los estados</SelectItem>
        {statuses.map((status) => (
          <SelectItem key={status.key} value={status.label.toLowerCase()}>
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

interface ExportManagerProps {
  orders: Sale[];
  onClose: () => void;
}

export function ExportManager({ orders, onClose }: ExportManagerProps) {
  const [exportFormat, setExportFormat] = useState('excel');
  const [includeFields, setIncludeFields] = useState({
    customerInfo: true,
    productInfo: true,
    statusInfo: true,
    financialInfo: true,
    locationInfo: true,
    comments: true
  });
  const [dateRange, setDateRange] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const filteredOrders = React.useMemo(() => {
    let filtered = orders;

    // Filter by date range
    if (dateRange !== 'all') {
      const now = new Date();
      const filterDate = new Date();
      
      switch (dateRange) {
        case 'today':
          filterDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          filterDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          filterDate.setMonth(now.getMonth() - 1);
          break;
      }
      
      filtered = filtered.filter(order => new Date(order.timestamp) >= filterDate);
    }

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status.toLowerCase() === statusFilter.toLowerCase());
    }

    return filtered;
  }, [orders, dateRange, statusFilter]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (exportFormat === 'excel') {
        await exportToExcel();
      } else if (exportFormat === 'csv') {
        await exportToCSV();
      } else if (exportFormat === 'pdf') {
        await exportToPDF();
      }
      
      toast({
        title: "Exportación exitosa",
        description: `${filteredOrders.length} órdenes exportadas correctamente.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error en la exportación",
        description: "No se pudo exportar el archivo. Inténtalo de nuevo.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const exportToExcel = async () => {
    // Create Excel-like CSV with proper formatting
    const headers = [];
    if (includeFields.customerInfo) {
      headers.push('ID Orden', 'Cliente', 'Teléfono', 'Email', 'Negocio');
    }
    if (includeFields.productInfo) {
      headers.push('Producto', 'Cantidad', 'Tamaño', 'Color', 'Empaque', 'Personalización');
    }
    if (includeFields.statusInfo) {
      headers.push('Estado', 'Tipo Orden', 'Canal', 'Vendedor');
    }
    if (includeFields.financialInfo) {
      headers.push('Costo Producto', 'Costo Envío', 'IVA', 'Total');
    }
    if (includeFields.locationInfo) {
      headers.push('Dirección', 'Provincia', 'Cantón', 'Distrito', 'Mensajería');
    }
    if (includeFields.comments) {
      headers.push('Comentarios');
    }
    headers.push('Fecha Creación', 'Fecha Esperada');

    const csvContent = [
      headers.join(','),
      ...filteredOrders.map(order => {
        const row = [];
        if (includeFields.customerInfo) {
          row.push(
            `"${order.orderId}"`,
            `"${order.customerName}"`,
            `"${order.phone}"`,
            `"${order.email || ''}"`,
            `"${order.business || ''}"`
          );
        }
        if (includeFields.productInfo) {
          row.push(
            `"${order.product}"`,
            order.quantity,
            `"${order.size || ''}"`,
            `"${order.color || ''}"`,
            `"${order.packaging || ''}"`,
            `"${order.customization || ''}"`
          );
        }
        if (includeFields.statusInfo) {
          row.push(
            `"${order.status}"`,
            `"${order.orderType}"`,
            `"${order.funnel || ''}"`,
            `"${(order as any).seller || ''}"`
          );
        }
        if (includeFields.financialInfo) {
          row.push(
            (order as any).productCost || 0,
            (order as any).shippingCost || 0,
            (order as any).iva || 0,
            order.total
          );
        }
        if (includeFields.locationInfo) {
          row.push(
            `"${(order as any).address || ''}"`,
            `"${(order as any).province || ''}"`,
            `"${(order as any).canton || ''}"`,
            `"${(order as any).district || ''}"`,
            `"${(order as any).courier || ''}"`
          );
        }
        if (includeFields.comments) {
          row.push(`"${order.comments || ''}"`);
        }
        row.push(
          `"${new Date(order.timestamp).toLocaleDateString()}"`,
          `"${(order as any).expectedDate || ''}"`
        );
        return row.join(',');
      })
    ].join('\n');

    // Download CSV file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ordenes_produccion_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToCSV = async () => {
    await exportToExcel(); // Same as Excel for now
  };

  const exportToPDF = async () => {
    // Generate PDF report
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const orderElements = filteredOrders.map(order => `
      <div class="order-item" style="border: 1px solid #ddd; margin: 10px 0; padding: 15px; page-break-inside: avoid;">
        <h3>Orden #${escapeHtml(order.orderId)}</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div>
            <strong>Cliente:</strong> ${escapeHtml(order.customerName || '')}<br>
            <strong>Teléfono:</strong> ${escapeHtml(order.phone || '')}<br>
            <strong>Producto:</strong> ${escapeHtml(order.product || '')}<br>
            <strong>Cantidad:</strong> ${escapeHtml(String(order.quantity ?? ''))}
          </div>
          <div>
            <strong>Estado:</strong> ${escapeHtml(order.status || '')}<br>
            <strong>Tipo:</strong> ${escapeHtml(order.orderType || '')}<br>
            <strong>Total:</strong> ₡${order.total.toLocaleString()}<br>
            <strong>Fecha:</strong> ${new Date(order.timestamp).toLocaleDateString()}
          </div>
        </div>
        ${order.comments ? `<p><strong>Comentarios:</strong> ${escapeHtml(order.comments)}</p>` : ''}
      </div>
    `).join('');

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Reporte de Producción</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .order-item { margin: 15px 0; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Reporte de Producción</h1>
            <p>Generado el: ${new Date().toLocaleDateString()}</p>
            <p>Total de órdenes: ${filteredOrders.length}</p>
          </div>
          ${orderElements}
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.print();
  };

  const toggleField = (field: keyof typeof includeFields) => {
    setIncludeFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Exportar Datos
            <Badge variant="secondary">
              {filteredOrders.length} órdenes
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Export Format */}
          <div className="space-y-3">
            <h3 className="font-semibold">Formato de Exportación</h3>
            <div className="grid grid-cols-3 gap-4">
              <div 
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  exportFormat === 'excel' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
                onClick={() => setExportFormat('excel')}
              >
                <FileSpreadsheet className="h-6 w-6 mx-auto mb-2" />
                <p className="text-sm font-medium text-center">Excel/CSV</p>
              </div>
              <div 
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  exportFormat === 'pdf' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
                onClick={() => setExportFormat('pdf')}
              >
                <FileText className="h-6 w-6 mx-auto mb-2" />
                <p className="text-sm font-medium text-center">PDF</p>
              </div>
              <div 
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  exportFormat === 'print' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
                onClick={() => setExportFormat('print')}
              >
                <Printer className="h-6 w-6 mx-auto mb-2" />
                <p className="text-sm font-medium text-center">Imprimir</p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <h3 className="font-semibold">Filtros</h3>
              <div>
                <label className="text-sm font-medium">Rango de fechas:</label>
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las fechas</SelectItem>
                    <SelectItem value="today">Hoy</SelectItem>
                    <SelectItem value="week">Última semana</SelectItem>
                    <SelectItem value="month">Último mes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Estado:</label>
                <StatusFilterExport value={statusFilter} onValueChange={setStatusFilter} />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Campos a Incluir</h3>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="customerInfo" 
                    checked={includeFields.customerInfo}
                    onCheckedChange={() => toggleField('customerInfo')}
                  />
                  <label htmlFor="customerInfo" className="text-sm">Información del Cliente</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="productInfo" 
                    checked={includeFields.productInfo}
                    onCheckedChange={() => toggleField('productInfo')}
                  />
                  <label htmlFor="productInfo" className="text-sm">Información del Producto</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="statusInfo" 
                    checked={includeFields.statusInfo}
                    onCheckedChange={() => toggleField('statusInfo')}
                  />
                  <label htmlFor="statusInfo" className="text-sm">Estado y Canal</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="financialInfo" 
                    checked={includeFields.financialInfo}
                    onCheckedChange={() => toggleField('financialInfo')}
                  />
                  <label htmlFor="financialInfo" className="text-sm">Información Financiera</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="locationInfo" 
                    checked={includeFields.locationInfo}
                    onCheckedChange={() => toggleField('locationInfo')}
                  />
                  <label htmlFor="locationInfo" className="text-sm">Ubicación</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="comments" 
                    checked={includeFields.comments}
                    onCheckedChange={() => toggleField('comments')}
                  />
                  <label htmlFor="comments" className="text-sm">Comentarios</label>
                </div>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <h4 className="font-medium mb-2">Vista Previa</h4>
            <p className="text-sm text-gray-600">
              Se exportarán <strong>{filteredOrders.length}</strong> órdenes en formato <strong>{exportFormat.toUpperCase()}</strong>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Campos incluidos: {Object.entries(includeFields)
                .filter(([_, included]) => included)
                .map(([field, _]) => field)
                .join(', ')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button 
            onClick={handleExport}
            disabled={isExporting}
            className="min-w-32"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exportando...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Exportar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
