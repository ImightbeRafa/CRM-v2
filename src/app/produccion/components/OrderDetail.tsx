import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { useState, useEffect, useMemo } from "react";
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

// Core fields that are ALWAYS shown (essential order info)
const CORE_FIELDS: Array<[string, SaleKeys, string?]> = [
  ['Usuario', 'username'],
  ['Cliente', 'customerName'],
  ['Teléfono', 'phone'],
  ['Email', 'email'],
  ['Negocio', 'business'],
  ['Producto', 'product'],
  ['Cantidad', 'quantity', 'number'],
  ['Vendedor', 'seller'],
];

export function OrderDetails({ 
  order, 
  onClose, 
  onUpdateStatus,
  onUpdateOrder 
}: OrderDetailsProps) {
  const [availableStatuses, setAvailableStatuses] = useState<Array<{key: string; label: string}>>([]);
  
  // Load available statuses from API
  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status', { credentials: 'include' });
        const data = await response.json();
        if (data.status === 'success' && data.data.length > 0) {
          setAvailableStatuses(data.data);
        }
      } catch (error) {
        console.error('Error loading statuses:', error);
      }
    };
    loadStatuses();
  }, []);
  const [isEditing, setIsEditing] = useState(false);
  const [displayOrder, setDisplayOrder] = useState<Sale>(order);
  const [editedOrder, setEditedOrder] = useState<Sale>(order);
  const [isSaving, setIsSaving] = useState(false);
  const [businessInfoFields, setBusinessInfoFields] = useState<any[]>([]);
  const [productFields, setProductFields] = useState<any[]>([]);
  
  useEffect(() => {
    setDisplayOrder(order);
    setEditedOrder(order);
  }, [order]);

  // Load tenant custom fields (both business info and product fields)
  useEffect(() => {
    const fetchCustomFields = async () => {
      try {
        // Fetch business info fields
        const businessRes = await fetch('/api/config/business-info', { credentials: 'include' });
        const businessData = await businessRes.json();
        if (businessData?.status === 'success' && Array.isArray(businessData.data)) {
          setBusinessInfoFields(businessData.data);
        }
        
        // Fetch product fields (Campos Personalizados)
        const productRes = await fetch('/api/config/fields', { credentials: 'include' });
        const productData = await productRes.json();
        if (productData?.status === 'success' && Array.isArray(productData.data)) {
          setProductFields(productData.data);
        }
      } catch (err) {
        console.error('Error loading custom fields:', err);
      }
    };
    fetchCustomFields();
  }, []);
  
  // Build a set of configured custom field keys to know what's enabled
  const configuredFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    productFields.forEach(f => keys.add(f.key?.toLowerCase()));
    businessInfoFields.forEach(f => keys.add(f.name?.toLowerCase()));
    return keys;
  }, [productFields, businessInfoFields]);

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
            {availableStatuses.length > 0 
              ? availableStatuses.map((s: any) => (
                  <option key={s.key || s.label} value={s.label}>{s.label}</option>
                ))
              : <option value={value?.toString() || ''}>{value?.toString() || 'Pendiente'}</option>
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

  // Build dynamic fields list based on what's configured + what has values
  const customerInfoFields = useMemo((): Array<[string, SaleKeys, string?]> => {
    const fields: Array<[string, SaleKeys, string?]> = [...CORE_FIELDS];
    
    // Optional fields that should only show if configured OR have values
    const optionalMappings: Array<{ key: string; label: string; field: SaleKeys; type?: string }> = [
      { key: 'size', label: 'Tamaño', field: 'size' },
      { key: 'tamano', label: 'Tamaño', field: 'size' },
      { key: 'color', label: 'Color', field: 'color' },
      { key: 'packaging', label: 'Empaque', field: 'packaging' },
      { key: 'empaque', label: 'Empaque', field: 'packaging' },
      { key: 'customization', label: 'Personalización', field: 'customization' },
      { key: 'personalizacion', label: 'Personalización', field: 'customization' },
      { key: 'delivery', label: 'Delivery', field: 'delivery' },
      { key: 'funnel', label: 'Canal de Ventas', field: 'funnel' },
    ];
    
    // Only add optional fields if they're configured OR have a value in this order
    const addedFields = new Set<SaleKeys>();
    optionalMappings.forEach(({ key, label, field, type }) => {
      if (addedFields.has(field)) return; // Avoid duplicates
      
      const isConfigured = configuredFieldKeys.has(key.toLowerCase());
      const value = (displayOrder as any)[field];
      const hasValue = value && String(value).trim() !== '';
      
      if (isConfigured || hasValue) {
        fields.push([label, field, type]);
        addedFields.add(field);
      }
    });
    
    return fields;
  }, [configuredFieldKeys, displayOrder]);

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

  // Build dynamic shipping fields - only show fields with values or configured
  const shippingFields = useMemo((): Array<[string, SaleKeys, string?]> => {
    const fields: Array<[string, SaleKeys, string?]> = [];
    
    // Core shipping fields that always show if they have values
    const coreShippingMappings: Array<{ key: string; label: string; field: SaleKeys; type?: string }> = [
      { key: 'address', label: 'Dirección', field: 'address' },
      { key: 'courier', label: 'Mensajería', field: 'courier' },
      { key: 'seller', label: 'Vendedor', field: 'seller' },
      { key: 'province', label: 'Provincia', field: 'province' },
      { key: 'canton', label: 'Cantón', field: 'canton' },
      { key: 'district', label: 'Distrito', field: 'district' },
      { key: 'productCost', label: 'Costo de Producto', field: 'productCost', type: 'number' },
      { key: 'shippingCost', label: 'Costo de Envío', field: 'shippingCost', type: 'number' },
    ];
    
    // Optional shipping fields - only show if configured OR have values
    const optionalShippingMappings: Array<{ key: string; label: string; field: SaleKeys; type?: string }> = [
      { key: 'expectedDate', label: 'Fecha Esperada', field: 'expectedDate' },
      { key: 'fechaEsperada', label: 'Fecha Esperada', field: 'expectedDate' },
      { key: 'saleDate', label: 'Fecha de Venta', field: 'saleDate' },
      { key: 'fechaVenta', label: 'Fecha de Venta', field: 'saleDate' },
      { key: 'iva', label: 'IVA', field: 'iva', type: 'number' },
    ];
    
    // Add core fields that have values
    coreShippingMappings.forEach(({ label, field, type }) => {
      const value = (displayOrder as any)[field];
      const hasValue = value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '0';
      if (hasValue) {
        fields.push([label, field, type]);
      }
    });
    
    // Add optional fields only if configured OR have values
    const addedFields = new Set<SaleKeys>();
    optionalShippingMappings.forEach(({ key, label, field, type }) => {
      if (addedFields.has(field)) return;
      
      const isConfigured = configuredFieldKeys.has(key.toLowerCase());
      const value = (displayOrder as any)[field];
      const hasValue = value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '0';
      
      if (isConfigured || hasValue) {
        fields.push([label, field, type]);
        addedFields.add(field);
      }
    });
    
    return fields;
  }, [configuredFieldKeys, displayOrder]);

  const renderShippingDetails = () => {
    if (shippingFields.length === 0) return null;
    return renderSection('Detalles de Envío', shippingFields);
  };

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
              {renderSection('Información del Cliente', customerInfoFields)}
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

              {displayOrder.orderType === 'RA' && (() => {
                // Build dynamic pickup fields - only show fields with values or configured
                const pickupFields: Array<[string, SaleKeys, string?]> = [];
                
                const pickupMappings: Array<{ key: string; label: string; field: SaleKeys; type?: string; optional?: boolean }> = [
                  { key: 'address', label: 'Dirección', field: 'address' },
                  { key: 'agreedDate', label: 'Fecha Acordada', field: 'agreedDate', optional: true },
                  { key: 'fechaAcordada', label: 'Fecha Acordada', field: 'agreedDate', optional: true },
                  { key: 'pickupDate', label: 'Fecha de Retiro', field: 'pickupDate', optional: true },
                  { key: 'fechaRetiro', label: 'Fecha de Retiro', field: 'pickupDate', optional: true },
                  { key: 'seller', label: 'Vendedor', field: 'seller' },
                  { key: 'productCost', label: 'Costo de Producto', field: 'productCost', type: 'number' },
                  { key: 'iva', label: 'IVA', field: 'iva', type: 'number', optional: true },
                ];
                
                const addedPickupFields = new Set<SaleKeys>();
                pickupMappings.forEach(({ key, label, field, type, optional }) => {
                  if (addedPickupFields.has(field)) return;
                  
                  const value = (displayOrder as any)[field];
                  const hasValue = value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '0';
                  const isConfigured = configuredFieldKeys.has(key.toLowerCase());
                  
                  // For optional fields, only show if configured OR have value
                  // For required fields, show if have value
                  if (optional ? (isConfigured || hasValue) : hasValue) {
                    pickupFields.push([label, field, type]);
                    addedPickupFields.add(field);
                  }
                });
                
                return pickupFields.length > 0 ? renderSection('Detalles de Retiro', pickupFields) : null;
              })()}

              {/* Dynamic Custom Fields (Campos personalizados) - Combined product fields and business info */}
              {(productFields.length > 0 || businessInfoFields.length > 0) && (
                <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="font-medium text-sm text-gray-600 dark:text-gray-300">Campos personalizados</h3>
                  </div>
                  <div className="p-4 space-y-2">
                    {/* Render product custom fields */}
                    {productFields.map((f) => {
                      // Try to get value from various sources
                      let value: any = (displayOrder as any)[f?.key];
                      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
                        value = (displayOrder as any)?.customFields?.[f?.key];
                      }
                      // Skip if no value
                      if (value === undefined || value === null || (typeof value === 'string' && String(value).trim() === '')) return null;
                      return (
                        <div key={`product-${f?.id || f?.key}`} className="group relative py-2 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-md px-2 -mx-2">
                          <div className="flex justify-between items-baseline">
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{f?.label || f?.key}</label>
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-100 font-medium mt-1">
                            {typeof value === 'number' ? value.toLocaleString() : String(value)}
                          </p>
                        </div>
                      );
                    })}
                    {/* Render business info custom fields */}
                    {businessInfoFields.map((f) => {
                      let value: any = (displayOrder as any)[f?.name];
                      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
                        value = (displayOrder as any)?.customFields?.[f?.name];
                      }
                      if ((value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) && (displayOrder as any)?.productDetails) {
                        try {
                          const pd = JSON.parse((displayOrder as any).productDetails as any);
                          value = pd?.customFields?.[f?.name];
                        } catch {}
                      }
                      if (value === undefined || value === null || (typeof value === 'string' && String(value).trim() === '')) return null;
                      return (
                        <div key={`business-${f?.id || f?.name}`} className="group relative py-2 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-md px-2 -mx-2">
                          <div className="flex justify-between items-baseline">
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{f?.label || f?.name}</label>
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-100 font-medium mt-1">
                            {typeof value === 'number' ? value.toLocaleString() : String(value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Comentario */}
              {displayOrder.comments && (
                <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="font-medium text-sm text-gray-600 dark:text-gray-300">Comentario</h3>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-gray-900 dark:text-gray-100">{displayOrder.comments}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}