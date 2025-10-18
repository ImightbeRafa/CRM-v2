import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { useState, useEffect } from "react";
import { Sale, SaleKeys } from '../types/sales';
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Pencil, X, Save } from "lucide-react";
import { Alert, AlertTitle } from "@/app/components/ui/alert";

interface OrderDetailsProps {
  order: Sale;
  onClose: () => void;
  onUpdateStatus: (newStatus: string) => Promise<void>;
  onUpdateOrder: (orderId: string, updatedData: Partial<Sale>) => Promise<Sale>;
}

export function OrderDetails({ 
  order, 
  onClose, 
  onUpdateStatus,
  onUpdateOrder 
}: OrderDetailsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [displayOrder, setDisplayOrder] = useState<Sale>(order);
  const [editedOrder, setEditedOrder] = useState<Sale>(order);
  const [isSaving, setIsSaving] = useState(false);
  
  useEffect(() => {
    setDisplayOrder(order);
    setEditedOrder(order);
  }, [order]);

  const handleInputChange = (field: SaleKeys, value: string | number) => {
    setEditedOrder(prev => {
      const newOrder = { ...prev };
      
      (newOrder[field as keyof Sale] as Sale[keyof Sale]) = value;
      
      if (field === 'productCost' || field === 'shippingCost') {
        const productCost = Number(newOrder.productCost) || 0;
        const shippingCost = newOrder.orderType === 'EA' 
          ? (Number(newOrder.shippingCost) || 0)
          : 0;
        newOrder.total = productCost + shippingCost;
      }
      
      return newOrder;
    });
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      
      // Detect changes for audit logging
      const changes: string[] = [];
      Object.keys(editedOrder).forEach(key => {
        const oldValue = displayOrder[key as keyof Sale];
        const newValue = editedOrder[key as keyof Sale];
        
        if (oldValue !== newValue && (oldValue || newValue)) {
          const fieldLabel = getFieldLabel(key);
          changes.push(`${fieldLabel}: "${oldValue || 'N/A'}" → "${newValue || 'N/A'}"`);
        }
      });
      
      if (changes.length > 0) {
        console.log('Order changes detected:', changes);
      }
      
      const updatedOrder = await onUpdateOrder(order.orderId, editedOrder);
      setDisplayOrder(updatedOrder);
      setEditedOrder(updatedOrder);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving order:', error);
      setEditedOrder(displayOrder);
    } finally {
      setIsSaving(false);
    }
  };

  const getFieldLabel = (key: string): string => {
    const labels: Record<string, string> = {
      'customerName': 'Cliente',
      'phone': 'Teléfono',
      'email': 'Email',
      'business': 'Negocio',
      'product': 'Producto',
      'quantity': 'Cantidad',
      'size': 'Tamaño',
      'color': 'Color',
      'packaging': 'Empaque',
      'customization': 'Personalización',
      'delivery': 'Delivery',
      'status': 'Estado',
      'funnel': 'Canal',
      'address': 'Dirección',
      'expectedDate': 'Fecha Esperada',
      'saleDate': 'Fecha de Venta',
      'courier': 'Mensajería',
      'seller': 'Vendedor',
      'province': 'Provincia',
      'canton': 'Cantón',
      'district': 'Distrito',
      'productCost': 'Costo de Producto',
      'shippingCost': 'Costo de Envío',
      'iva': 'IVA',
      'total': 'Total',
      'comments': 'Comentarios',
      'agreedDate': 'Fecha Acordada',
      'pickupDate': 'Fecha de Retiro'
    };
    return labels[key] || key;
  };

  const handleCancelEdit = () => {
    setEditedOrder(displayOrder);
    setIsEditing(false);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Pendiente': 'bg-yellow-100 text-yellow-800',
      'En Proceso': 'bg-blue-100 text-blue-800',
      'Completado': 'bg-green-100 text-green-800',
      'Enviado': 'bg-purple-100 text-purple-800',
      'Entregado': 'bg-purple-100 text-purple-800',
      'Drive': 'bg-indigo-100 text-indigo-800',
      'Impreso': 'bg-cyan-100 text-cyan-800',
      'PendienteDiseño': 'bg-orange-100 text-orange-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const renderField = (label: string, field: SaleKeys, type: string = 'text') => {
    const value = isEditing ? editedOrder[field as keyof Sale] : displayOrder[field as keyof Sale];
    
    if (!isEditing) {
      return (
        <div className="group relative py-2 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-md px-2 -mx-2">
          <div className="flex justify-between items-baseline">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
            {field === 'status' && value && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(value.toString())}`}>
                {value.toString()}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-900 dark:text-gray-100 font-medium mt-1">
            {type === 'number' && typeof value === 'number' 
              ? value.toLocaleString()
              : value?.toString() || '-'
            }
          </p>
        </div>
      );
    }

    if (field === 'comments') {
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
          <Textarea
            value={value?.toString() || ''}
            onChange={(e) => handleInputChange(field, e.target.value)}
            className="min-h-[120px] resize-none transition-colors"
            placeholder={`Ingrese ${label.toLowerCase()}...`}
          />
        </div>
      );
    }

    if (field === 'status') {
      return (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm 
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            value={value?.toString()}
            onChange={(e) => {
              handleInputChange(field, e.target.value);
              onUpdateStatus(e.target.value);
            }}
          >
            {['Pendiente', 'En Proceso', 'Completado', 'Entregado', 'Drive', 'Impreso', 'PendienteDiseño', 'Enviado']
              .map(status => (
                <option key={status} value={status}>{status}</option>
              ))
            }
          </select>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <Input
          type={type}
          value={value?.toString() || ''}
          onChange={(e) => handleInputChange(field, 
            type === 'number' ? parseFloat(e.target.value) : e.target.value
          )}
          placeholder={`Ingrese ${label.toLowerCase()}...`}
          className="transition-colors"
        />
      </div>
    );
  };

  const renderSection = (title: string, fields: Array<[string, SaleKeys, string?]>) => (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
      <div className="p-4 border-b border-gray-100 dark:border-gray-800">
        <h3 className="font-medium text-sm text-gray-600 dark:text-gray-300">{title}</h3>
      </div>
      <div className="p-4 space-y-4">
        {fields.map(([label, field, type]) => (
          <div key={`${title}-${String(field)}`}>
            {renderField(label, field, type)}
          </div>
        ))}
      </div>
    </div>
  );

  const commonFields: Array<[string, SaleKeys, string?]> = [
    ['Usuario', 'username'],
    ['Cliente', 'customerName'],
    ['Teléfono', 'phone'],
    ['Email', 'email'],
    ['Negocio', 'business'],
    ['Producto', 'product'],
    ['Cantidad', 'quantity', 'number'],
    ['Tamaño', 'size'],
    ['Color', 'color'],
    ['Empaque', 'packaging'],
    ['Personalización', 'customization'],
    ['Delivery', 'delivery'],
    ['Timestamp', 'timestamp']
  ];

  const renderTotal = () => {
    const total = isEditing ? editedOrder.total : displayOrder.total;
    return (
      <div className="group relative py-2 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-md px-2 -mx-2">
        <div className="flex justify-between items-baseline">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Total</label>
        </div>
        <p className="text-sm text-gray-900 dark:text-gray-100 font-medium mt-1">
          {typeof total === 'number' ? total.toLocaleString() : '-'}
        </p>
      </div>
    );
  };

  const renderShippingDetails = () => (
    renderSection('Detalles de Envío', [
      ['Dirección', 'address'],
      ['Fecha Esperada', 'expectedDate'],
      ['Fecha de Venta', 'saleDate'],
      ['Mensajería', 'courier'],
      ['Vendedor', 'seller'],
      ['Provincia', 'province'],
      ['Cantón', 'canton'],
      ['Distrito', 'district'],
      ['Costo de Producto', 'productCost', 'number'],
      ['Costo de Envío', 'shippingCost', 'number'],
      ['IVA', 'iva', 'number']
    ])
  );

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 py-4 border-b bg-white dark:bg-gray-900 sticky top-0 z-10">
          <DialogTitle className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <span className="text-lg font-semibold">Orden {displayOrder.orderId}</span>
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                {displayOrder.orderType}
              </span>
              {displayOrder.status && (
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(displayOrder.status)}`}>
                  {displayOrder.status}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant={isEditing ? "outline" : "ghost"}
                size="sm"
                className="h-8 px-3"
                onClick={() => {
                  if (isEditing) {
                    handleCancelEdit();
                  } else {
                    setIsEditing(true);
                  }
                }}
              >
                {isEditing ? (
                  <>
                    <X className="h-4 w-4 mr-2" />
                    Cancelar
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar
                  </>
                )}
              </Button>
              {isEditing && (
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="h-8"
                >
                  {isSaving ? (
                    <>
                      <span className="animate-spin mr-2">⌛</span>
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Guardar
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 h-full max-h-[calc(90vh-8rem)] bg-gray-50 dark:bg-gray-900/50">
          <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-6">
              {renderSection('Información del Cliente', commonFields)}
            </div>

            <div className="space-y-6">
              {renderSection('Estado', [
                ['Estado', 'status'],
                ['Canal', 'funnel']
              ])}

              {displayOrder.orderType === 'EA' && (
                <>
                  {renderShippingDetails()}
                  <div key="total-section" className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
                    <div className="p-4">
                      {renderTotal()}
                    </div>
                  </div>
                </>
              )}

              {displayOrder.orderType === 'RA' && renderSection('Detalles de Retiro', [
                ['Dirección', 'address'],
                ['Fecha Acordada', 'agreedDate'],
                ['Fecha de Retiro', 'pickupDate'],
                ['Vendedor', 'seller'],
                ['Costo de Producto', 'productCost', 'number'],
                ['IVA', 'iva', 'number']
              ])}

              {renderSection('Comentarios', [['Comentarios', 'comments']])}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}