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
import { 
  getTenantCustomFields, 
  shouldDisplayField, 
  getFieldLabel,
  extractCustomFields,
  CustomFieldsData 
} from "@/lib/customFields";

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
  const [customFieldsConfig, setCustomFieldsConfig] = useState<CustomFieldsData>({
    productFields: [],
    businessInfoFields: []
  });
  const [customFieldsLoaded, setCustomFieldsLoaded] = useState(false);
  
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
  
  useEffect(() => {
    setDisplayOrder(order);
    setEditedOrder(order);
  }, [order]);

  // Load tenant custom fields configuration
  useEffect(() => {
    const fetchCustomFieldsConfig = async () => {
      try {
        // We need to get the tenant ID from the order or session
        // For now, we'll fetch from the API which handles tenant context
        const response = await fetch('/api/config/fields', { credentials: 'include' });
        const productData = await response.json();
        
        const businessResponse = await fetch('/api/config/business-info', { credentials: 'include' });
        const businessData = await businessResponse.json();
        
        const config: CustomFieldsData = {
          productFields: productData?.status === 'success' ? productData.data : [],
          businessInfoFields: businessData?.status === 'success' ? businessData.data : []
        };
        
        setCustomFieldsConfig(config);
        setCustomFieldsLoaded(true);
      } catch (err) {
        console.error('Error loading custom fields config:', err);
        setCustomFieldsLoaded(true); // Still mark as loaded to prevent infinite loading state
      }
    };
    fetchCustomFieldsConfig();
  }, []);
  
  // Extract custom fields from the order
  const extractedCustomFields = useMemo(() => {
    const extracted = extractCustomFields(displayOrder, customFieldsConfig);
    
    // Debug logging in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[OrderDetail] Custom fields extraction:', {
        orderCustomFields: displayOrder.customFields,
        configuredProductFields: customFieldsConfig.productFields.map(f => f.key),
        configuredBusinessFields: customFieldsConfig.businessInfoFields.map(f => f.name),
        extracted
      });
    }
    
    return extracted;
  }, [displayOrder, customFieldsConfig]);
  
  // Get raw custom fields from order for fallback display
  const rawCustomFields = useMemo(() => {
    if (!displayOrder.customFields) return {};
    try {
      return typeof displayOrder.customFields === 'string' 
        ? JSON.parse(displayOrder.customFields) 
        : displayOrder.customFields;
    } catch {
      return {};
    }
  }, [displayOrder.customFields]);

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
      'product': 'Producto',
      'quantity': 'Cantidad',
      'size': 'Tamaño',
      'color': 'Color',
      'packaging': 'Empaque',
      'customization': 'Personalización',
      'delivery': 'Delivery',
      'status': 'Estado',
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

  // Customer info shows only core fields
  // All custom fields (tenant-defined) are displayed in the "Campos personalizados" section
  const customerInfoFields = useMemo((): Array<[string, SaleKeys, string?]> => {
    return [...CORE_FIELDS];
  }, []);

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

  // Build shipping fields - show fields that have values
  const shippingFields = useMemo((): Array<[string, SaleKeys, string?]> => {
    const fields: Array<[string, SaleKeys, string?]> = [];
    
    // Shipping-specific fields from the order
    const shippingMappings: Array<{ label: string; field: SaleKeys; type?: string }> = [
      { label: 'Dirección', field: 'address' },
      { label: 'Mensajería', field: 'courier' },
      { label: 'Provincia', field: 'province' },
      { label: 'Cantón', field: 'canton' },
      { label: 'Distrito', field: 'district' },
      { label: 'Costo de Producto', field: 'productCost', type: 'number' },
      { label: 'Costo de Envío', field: 'shippingCost', type: 'number' },
      { label: 'Fecha de Venta', field: 'saleDate' },
      { label: 'IVA', field: 'iva', type: 'number' },
    ];
    
    // Add fields that have values
    shippingMappings.forEach(({ label, field, type }) => {
      const value = (displayOrder as any)[field];
      const hasValue = value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '0';
      if (hasValue) {
        fields.push([label, field, type]);
      }
    });
    
    return fields;
  }, [displayOrder]);

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
                ['Estado', 'status']
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
                // Build pickup fields - show fields that have values
                const pickupFields: Array<[string, SaleKeys, string?]> = [];
                
                const pickupMappings: Array<{ label: string; field: SaleKeys; type?: string }> = [
                  { label: 'Dirección', field: 'address' },
                  { label: 'Fecha Acordada', field: 'agreedDate' },
                  { label: 'Fecha de Retiro', field: 'pickupDate' },
                  { label: 'Costo de Producto', field: 'productCost', type: 'number' },
                  { label: 'IVA', field: 'iva', type: 'number' },
                ];
                
                const addedPickupFields = new Set<SaleKeys>();
                pickupMappings.forEach(({ label, field, type }) => {
                  if (addedPickupFields.has(field)) return;
                  
                  const value = (displayOrder as any)[field];
                  const hasValue = value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '0';
                  
                  if (hasValue) {
                    pickupFields.push([label, field, type]);
                    addedPickupFields.add(field);
                  }
                });
                
                return pickupFields.length > 0 ? renderSection('Detalles de Retiro', pickupFields) : null;
              })()}

              {/* Dynamic Custom Fields (Campos personalizados) - Display tenant-configured fields AND raw data */}
              {customFieldsLoaded && (() => {
                // Collect all custom field values to display
                const fieldsToDisplay: Array<{ key: string; label: string; value: any; type?: string }> = [];
                
                // 1. First add configured product fields with values
                customFieldsConfig.productFields.forEach((field) => {
                  const value = extractedCustomFields[field.key];
                  if (value !== undefined && value !== null && value !== '') {
                    fieldsToDisplay.push({ key: field.key, label: field.label, value, type: field.type });
                  }
                });
                
                // 2. Add configured business info fields with values
                customFieldsConfig.businessInfoFields.forEach((field) => {
                  const value = extractedCustomFields[field.name];
                  if (value !== undefined && value !== null && value !== '') {
                    fieldsToDisplay.push({ key: field.name, label: field.label, value, type: field.type });
                  }
                });
                
                // 3. Add any raw custom fields that weren't matched by config (fallback display)
                const matchedKeys = new Set(fieldsToDisplay.map(f => f.key));
                Object.entries(rawCustomFields).forEach(([key, value]) => {
                  if (!matchedKeys.has(key) && value !== undefined && value !== null && value !== '') {
                    // Try to find a nice label from config, otherwise use the key
                    const productField = customFieldsConfig.productFields.find(f => f.key === key);
                    const businessField = customFieldsConfig.businessInfoFields.find(f => f.name === key);
                    const label = productField?.label || businessField?.label || key;
                    fieldsToDisplay.push({ key, label, value, type: 'text' });
                  }
                });
                
                // Don't render section if no fields to display
                if (fieldsToDisplay.length === 0) return null;
                
                return (
                  <div className="rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                      <h3 className="font-medium text-sm text-gray-600 dark:text-gray-300">Campos personalizados</h3>
                    </div>
                    <div className="p-4 space-y-2">
                      {fieldsToDisplay.map((field) => (
                        <div key={`custom-${field.key}`} className="group relative py-2 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-md px-2 -mx-2">
                          <div className="flex justify-between items-baseline">
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                              {field.label}
                            </label>
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-100 font-medium mt-1">
                            {field.type === 'number' ? Number(field.value).toLocaleString('es-CR') : 
                             field.type === 'boolean' ? (field.value ? 'Sí' : 'No') :
                             field.type === 'date' ? new Date(field.value).toLocaleDateString('es-CR') :
                             String(field.value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

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