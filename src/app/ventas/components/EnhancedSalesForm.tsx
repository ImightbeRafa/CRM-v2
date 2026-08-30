import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Save, Loader, AlertCircle, CheckCircle, Clock, Banknote } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import OrderTypeToggle from './OrderTypeToggle';
import CustomerForm from './customerForm';
import ProductList from './ProductList';
import EnhancedSmartSuggestions from './EnhancedSmartSuggestions';
import RecurringCustomers from './RecurringCustomers';
import { ShippingMethodSelector } from './ShippingMethodSelector';
import { validateOrderForm, type OrderFieldErrors } from './orderFormValidation';
import { CustomerInfo, ProductInfo, OrderInfo, SubmitStatus, ProductTemplate, CustomerSuggestion } from './types';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useConfig } from '@/app/contexts/ConfigContext';
import { paymentChoiceToOrderFields, type ManualPaymentChoice } from '@/lib/order-payment-status';

interface EnhancedSalesFormProps {
  showOrderForm: boolean;
  onToggleForm: (show: boolean) => void;
}

const EnhancedSalesForm: React.FC<EnhancedSalesFormProps> = ({ showOrderForm, onToggleForm }) => {
  const { user } = useCurrentUser();
  const { getState } = useConfig();
  const fieldsState = getState<any[]>('fields');
  const productFieldConfigs = fieldsState.data ?? [];
  const [orderInfo, setOrderInfo] = useState<OrderInfo>({
    customerInfo: {
      name: '',
      phone: '',
      province: '',
      canton: '',
      district: '',
      email: '',
      username: '',
      address: '',
      business: '',
      funnel: '',
      comments: '',
      fechaEsperada: '',
      fechaRetiro: '',
      diaVenta: '',
      orderType: 'EA',
    },
    products: [],
    orderTotal: 0,
    orderIVA: 0,
    orderSubtotal: 0,
    orderShipping: 0,
    contraEntrega: false,
    paymentChoice: 'pendiente_pago',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ type: '', message: '' });
  const [rawCustomerText, setRawCustomerText] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [businessInfoFields, setBusinessInfoFields] = useState<any[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<OrderFieldErrors>({});

  // Resolve expected date from either the canonical field (fechaEsperada)
  // or from any business info date field (prefer one whose name/label mentions "esperada" or "expected")
  const resolveExpectedDate = (): string => {
    const direct = (orderInfo.customerInfo as any).fechaEsperada?.toString()?.trim();
    if (direct) return direct;
    let fallback: string = '';
    for (const f of businessInfoFields) {
      if (f?.type === 'date') {
        const value = (orderInfo.customerInfo as any)[f.name]?.toString()?.trim();
        if (!value) continue;
        const key = `${f?.name || ''} ${f?.label || ''}`.toLowerCase();
        if (/(fecha.*esperada|expected)/.test(key)) return value;
        if (!fallback) fallback = value; // keep first non-empty date as fallback
      }
    }
    return fallback;
  };

  // Auto-assign vendedor to products that don't have one
  useEffect(() => {
    if (user && orderInfo.products.some(p => !p.vendedor || !p.vendedor.trim())) {
      setOrderInfo(prev => ({
        ...prev,
        products: prev.products.map(product => ({
          ...product,
          vendedor: (!product.vendedor || !product.vendedor.trim()) ? user.username : product.vendedor
        }))
      }));
    }
  }, [user, orderInfo.products]);

  // Fetch business info fields and product field configs (non-blocking with cache)
  useEffect(() => {
    // Check cache first for business info
    const cached = sessionStorage.getItem('businessInfoFields');
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < 300000) { // 5 minutes
          setBusinessInfoFields(data);
        } else {
          sessionStorage.removeItem('businessInfoFields');
        }
      } catch (e) {
        sessionStorage.removeItem('businessInfoFields');
      }
    }

    // Fetch business info fields
    fetch('/api/config/business-info', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setBusinessInfoFields(data.data);
          sessionStorage.setItem('businessInfoFields', JSON.stringify({
            data: data.data,
            timestamp: Date.now()
          }));
        }
      })
      .catch(error => console.error('Error fetching business info fields:', error));
  }, []);

  // Initialize client-side state
  useEffect(() => {
    setIsClient(true);
    // Set initial date on client side
    setOrderInfo(prev => ({
      ...prev,
      customerInfo: {
        ...prev.customerInfo,
        diaVenta: new Date().toISOString().split('T')[0]
      }
    }));
  }, []);

  // Auto-save functionality
  const autoSave = useCallback(async () => {
    if (!isClient || (orderInfo.products.length === 0 && !orderInfo.customerInfo.name)) return;

    setAutoSaveStatus('saving');
    try {
      const autoSaveData = {
        customerInfo: orderInfo.customerInfo,
        products: orderInfo.products,
        timestamp: new Date().toISOString()
      };

      // Save to localStorage for now (can be enhanced to save to server)
      if (typeof window !== 'undefined') {
        localStorage.setItem('betsy_autosave', JSON.stringify(autoSaveData));
        setLastAutoSave(new Date());
        setAutoSaveStatus('saved');
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
      setAutoSaveStatus('unsaved');
    }
  }, [orderInfo, isClient]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!isClient || !isMounted) return;
    const interval = setInterval(() => {
      if (isMounted) {
        autoSave();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isClient, isMounted, autoSave]);

  // Load auto-saved data on component mount
  useEffect(() => {
    if (!isClient) return;

    const savedData = localStorage.getItem('betsy_autosave');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.customerInfo || parsed.products?.length > 0) {
          const savedCustomerInfo = {
            ...parsed.customerInfo,
            comments: parsed.customerInfo?.comments ?? parsed.customerInfo?.comentarios ?? ''
          };

          setOrderInfo(prev => ({
            ...prev,
            customerInfo: { ...prev.customerInfo, ...savedCustomerInfo },
            products: parsed.products || []
          }));
        }
      } catch (error) {
        console.error('Failed to load auto-saved data:', error);
      }
    }
  }, [isClient]);

  // Mark as unsaved when data changes
  useEffect(() => {
    if (orderInfo.products.length > 0 || orderInfo.customerInfo.name) {
      setAutoSaveStatus('unsaved');
    }
  }, [orderInfo]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setIsMounted(false);
      // Clear any pending timeouts
      if ((window as any).__betsy_success_timeout) {
        clearTimeout((window as any).__betsy_success_timeout);
        delete (window as any).__betsy_success_timeout;
      }
    };
  }, []);

  const validateForm = (): OrderFieldErrors => {
    return validateOrderForm({
      customerInfo: orderInfo.customerInfo,
      products: orderInfo.products,
      orderShippingMethod: orderInfo.orderShippingMethod,
      businessInfoFields,
    });
  };

  const scrollToFirstError = (errors: OrderFieldErrors) => {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    const fieldName = firstKey.startsWith('product-')
      ? 'products'
      : firstKey.startsWith('business-')
        ? firstKey.slice('business-'.length)
        : firstKey;
    const node = document.querySelector(`[data-field="${fieldName}"]`) as HTMLElement | null;
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = node?.querySelector('input, select, textarea, button') as HTMLElement | null;
    focusable?.focus();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Auto-assign vendedor before validation if user is loaded and products are missing vendedor
    if (user && orderInfo.products.some(p => !p.vendedor || !p.vendedor.trim())) {
      const updatedProducts = orderInfo.products.map(product => ({
        ...product,
        vendedor: (!product.vendedor || !product.vendedor.trim()) ? user.username : product.vendedor
      }));
      setOrderInfo(prev => ({ ...prev, products: updatedProducts }));
      // Update orderInfo for validation
      orderInfo.products = updatedProducts;
    }

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const summary = Object.values(errors).join(' · ');
      setSubmitStatus({
        type: 'error',
        message: summary,
      });
      scrollToFirstError(errors);
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);
    setSubmitStatus({ type: '', message: '' });

    try {
      // --- Detect comment from business info fields ---
      const commentKeywords = ['comentario', 'comentarios', 'comment', 'comments', 'observacion', 'observaciones', 'nota', 'notas']
      const directComment = String(
        orderInfo.customerInfo.comments ?? (orderInfo.customerInfo as any).comentarios ?? ''
      ).trim()
      let customComment = ''
      for (const f of businessInfoFields) {
        const nameL = (f?.name || '').toLowerCase()
        const labelL = (f?.label || '').toLowerCase()
        if (commentKeywords.some(k => nameL.includes(k) || labelL.includes(k))) {
          const raw = (orderInfo.customerInfo as any)[f.name]
          if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
            customComment = String(raw).trim()
            break
          }
        }
      }
      const orderComment = directComment || customComment

      // --- Gather BusinessInfo custom fields from customerInfo ---
      const customFieldsToSend: Record<string, any> = {}
      businessInfoFields.forEach((f: any) => {
        if (!f?.name) return;
        const val = (orderInfo.customerInfo as any)[f.name];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          customFieldsToSend[f.name] = val;
        }
      });

      // --- Gather ProductField custom fields from products ---
      // Known standard keys on ProductInfo that should NOT go into customFields
      const standardProductKeys = new Set(['id', 'type', 'color', 'packaging', 'comments', 'cantidad', 'productCost', 'shippingCost', 'iva', 'total', 'vendedor', 'mensajeria', 'tamano', 'personalizado', 'optionDeltas']);
      const productFieldKeys = productFieldConfigs.map((f: any) => f.key).filter(Boolean);

      orderInfo.products.forEach((p: any) => {
        for (const key of productFieldKeys) {
          if (standardProductKeys.has(key)) continue;
          const val = p[key];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            // If multiple products have the same field, join values
            if (customFieldsToSend[key] && customFieldsToSend[key] !== val) {
              customFieldsToSend[key] = `${customFieldsToSend[key]}, ${val}`;
            } else {
              customFieldsToSend[key] = val;
            }
          }
        }
      });

      const paymentFields = paymentChoiceToOrderFields(
        (orderInfo.paymentChoice || 'pendiente_pago') as ManualPaymentChoice,
      );
      customFieldsToSend.paymentStatus = paymentFields.paymentStatus;
      const isPickup = orderInfo.customerInfo.orderType === 'RA';

      if (process.env.NODE_ENV === 'development') {
        console.log('[SalesForm] customFieldsToSend:', customFieldsToSend)
      }

      const orderData = {
        orderId: `ORDER-${Date.now()}`,
        orderType: orderInfo.customerInfo.orderType || 'EA',
        status: 'Pendiente',
        customerName: orderInfo.customerInfo.name,
        username: orderInfo.customerInfo.username || '',
        phone: orderInfo.customerInfo.phone || '',
        email: orderInfo.customerInfo.email || '',
        business: orderInfo.customerInfo.business || '',
        product: orderInfo.products.map(p => p.type).join(', '),
        quantity: orderInfo.products.reduce((sum, p) => sum + p.cantidad, 0),
        iva: orderInfo.orderIVA,
        shippingCost: isPickup ? 0 : orderInfo.orderShipping,
        address: isPickup ? '' : (orderInfo.customerInfo.address || ''),
        province: isPickup ? '' : (orderInfo.customerInfo.province || ''),
        canton: isPickup ? '' : (orderInfo.customerInfo.canton || ''),
        district: isPickup ? '' : (orderInfo.customerInfo.district || ''),
        courier: isPickup ? '' : orderInfo.orderShippingMethod,
        funnel: orderInfo.customerInfo.funnel || '',
        seller: orderInfo.products.length > 0 ? orderInfo.products[0].vendedor || user?.username || '' : '',
        expectedDate: resolveExpectedDate() || '',
        agreedDate: orderInfo.customerInfo.fechaRetiro || '',
        pickupDate: orderInfo.customerInfo.fechaRetiro || '',
        productCost: orderInfo.products.reduce((sum, p) => sum + (p.productCost * p.cantidad), 0),
        size: orderInfo.products.map(p => p.tamano).join(', '),
        color: orderInfo.products.map(p => p.color).join(', '),
        packaging: orderInfo.products.map(p => p.packaging).join(', '),
        customization: orderInfo.products.length > 0 ? orderInfo.products[0].personalizado || '' : '',
        comments: orderComment,
        // Store detailed product information including custom field values
        productDetails: JSON.stringify(orderInfo.products.map((p: any) => {
          const details: any = {
            type: p.type,
            cantidad: p.cantidad,
            color: p.color,
            tamano: p.tamano,
            productCost: p.productCost
          };
          // Include ProductField custom values in productDetails
          for (const key of productFieldKeys) {
            if (standardProductKeys.has(key)) continue;
            if (p[key] !== undefined && p[key] !== null && String(p[key]).trim() !== '') {
              details[key] = p[key];
            }
          }
          return details;
        })),
        timestamp: new Date(),
        saleDate: new Date().toISOString(),
        contraEntrega: paymentFields.contraEntrega,
        customFields: customFieldsToSend,
      };

      if (process.env.NODE_ENV === 'development') {
        console.log('[SalesForm] orderData.customFields:', orderData.customFields);
        console.log('[SalesForm] orderData.comments:', orderData.comments);
      }

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(orderData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Error al guardar el pedido');
      }

      const result = await response.json();

      // Update or create customer record with current info
      try {
        await fetch('/api/config/automatic-clients/update-from-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            customerId: selectedCustomerId, // If a customer was selected, update that specific one
            name: orderInfo.customerInfo.name,
            phone: orderInfo.customerInfo.phone,
            email: orderInfo.customerInfo.email,
            province: orderInfo.customerInfo.province,
            canton: orderInfo.customerInfo.canton,
            district: orderInfo.customerInfo.district,
            address: orderInfo.customerInfo.address,
            business: orderInfo.customerInfo.business,
            username: orderInfo.customerInfo.username
          })
        });
      } catch (clientUpdateError) {
        console.error('Failed to update client record:', clientUpdateError);
      }

      // Trigger automatic client sync after successful order creation
      try {
        const syncResponse = await fetch('/api/config/automatic-clients/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include'
        });

        if (syncResponse.ok) {
          console.log('Client sync completed successfully');
        } else {
          console.warn('Client sync failed, but order was created successfully');
        }
      } catch (syncError) {
        console.warn('Client sync failed, but order was created successfully:', syncError);
      }

      setSubmitStatus({
        type: 'success',
        message: `✅ Pedido guardado exitosamente con ${orderInfo.products.length} producto(s) - ID: ${result.data.orderId}`
      });

      // Clear auto-save data after successful submission
      localStorage.removeItem('betsy_autosave');

      // Auto-hide success message after 5 seconds
      const timeoutId = setTimeout(() => {
        if (isMounted) {
          setSubmitStatus({ type: '', message: '' });
        }
      }, 5000);

      // Store timeout ID for cleanup
      (window as any).__betsy_success_timeout = timeoutId;

      resetForm();

    } catch (error) {
      setSubmitStatus({
        type: 'error',
        message: error instanceof Error
          ? `❌ Error: ${error.message}`
          : '❌ Error al guardar el pedido. Por favor intente de nuevo.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setOrderInfo({
      customerInfo: {
        name: '',
        phone: '',
        province: '',
        canton: '',
        district: '',
        email: '',
        username: '',
        address: '',
        business: '',
        funnel: '',
        comments: '',
        fechaEsperada: '',
        fechaRetiro: '',
        diaVenta: isClient ? new Date().toISOString().split('T')[0] : '',
        orderType: 'EA',
      },
      products: [],
      orderTotal: 0,
      orderIVA: 0,
      orderSubtotal: 0,
      orderShipping: 0,
      contraEntrega: false,
      paymentChoice: 'pendiente_pago',
    });
    setFieldErrors({});

    setRawCustomerText('');
    setAutoSaveStatus('saved');
    setLastAutoSave(null);
    setSelectedCustomerId(null);

    // Clear localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('betsy_autosave');
    }
  };

  const handleOrderInfoChange = useCallback((newOrderInfo: OrderInfo) => {
    setOrderInfo(newOrderInfo);
  }, []);

  const handleCustomerInfoChange = (customerInfo: CustomerInfo) => {
    setOrderInfo(prev => ({ ...prev, customerInfo }));
  };

  const handleProductSelect = (productTemplate: ProductTemplate) => {
    const newProduct: ProductInfo = {
      id: `product_${Date.now()}`,
      type: productTemplate.type,
      color: productTemplate.color,
      packaging: '',
      comments: '',
      cantidad: 1,
      // Use selling price as base unit price in sales
      productCost: productTemplate.baseCost,
      shippingCost: 0,
      iva: 0,
      total: productTemplate.baseCost,
      vendedor: user?.username || '',
      mensajeria: '',
      tamano: productTemplate.tamano,
      personalizado: '',
      optionDeltas: 0
    };

    setOrderInfo(prev => ({
      ...prev,
      products: [...prev.products, newProduct]
    }));
  };

  const handleCustomerSelect = (customerSuggestion: CustomerSuggestion) => {
    // Store the selected customer ID so we can update the right record
    setSelectedCustomerId(customerSuggestion.id);

    setOrderInfo(prev => ({
      ...prev,
      customerInfo: {
        ...prev.customerInfo,
        name: customerSuggestion.name,
        phone: customerSuggestion.phone,
        email: customerSuggestion.email || prev.customerInfo.email,
        province: customerSuggestion.province,
        canton: customerSuggestion.canton,
        district: customerSuggestion.district,
        address: customerSuggestion.address || prev.customerInfo.address,
        business: customerSuggestion.business || prev.customerInfo.business,
        username: customerSuggestion.username || prev.customerInfo.username
      }
    }));
  };

  return (
    <>
      <Card role="main" aria-label="Nuevo pedido">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <CardTitle className="flex items-center gap-2">
                  Nuevo pedido
                  {autoSaveStatus === 'saving' && (
                    <Clock className="h-4 w-4 text-blue-500 dark:text-blue-400 animate-spin" />
                  )}
                  {autoSaveStatus === 'saved' && lastAutoSave && (
                    <CheckCircle className="h-4 w-4 text-green-500 dark:text-green-400" />
                  )}
                  {autoSaveStatus === 'unsaved' && (
                    <AlertCircle className="h-4 w-4 text-orange-500 dark:text-orange-400" />
                  )}
                </CardTitle>
                <Button
                  onClick={() => onToggleForm(false)}
                  variant="outline"
                  size="sm"
                  className="ml-2"
                >
                  Cerrar
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {autoSaveStatus === 'saved' && lastAutoSave &&
                  `Guardado automáticamente: ${lastAutoSave.toLocaleTimeString()}`
                }
                {autoSaveStatus === 'unsaved' && 'Cambios sin guardar'}
                {autoSaveStatus === 'saving' && 'Guardando...'}
              </p>
            </div>
            <OrderTypeToggle
              orderType={orderInfo.customerInfo.orderType}
              onOrderTypeChange={(type) =>
                setOrderInfo(prev => ({
                  ...prev,
                  orderShippingMethod: type === 'RA' ? '' : prev.orderShippingMethod,
                  orderShipping: type === 'RA' ? 0 : prev.orderShipping,
                  customerInfo: {
                    ...prev.customerInfo,
                    orderType: type,
                    ...(type === 'RA'
                      ? { province: '', canton: '', district: '', address: '' }
                      : {}),
                  },
                }))
              }
            />
          </div>
        </CardHeader>

        <CardContent>
          {submitStatus.message && (
            <Alert
              className={`mb-4 ${submitStatus.type === 'success' ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50'
                }`}
            >
              <AlertTitle className={submitStatus.type === 'success' ? 'text-green-800 dark:text-green-400' : 'text-red-800 dark:text-red-400'}>
                {submitStatus.type === 'success' ? 'Éxito' : 'Revisa estos campos'}
              </AlertTitle>
              <AlertDescription className={submitStatus.type === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}>
                {submitStatus.type === 'error' && Object.keys(fieldErrors).length > 0 ? (
                  <ul className="list-disc pl-4 space-y-1">
                    {Object.values(fieldErrors).map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                ) : submitStatus.message}
              </AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground mb-4">Los campos con <span className="text-red-500">*</span> son obligatorios.</p>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Customer Information */}
            <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-400 mb-4">
                👤 Información del Cliente
              </h3>

              {/* Recurring Customers - At top of customer form */}
              <RecurringCustomers
                onCustomerSelect={handleCustomerSelect}
                currentCustomerName={orderInfo.customerInfo.name}
              />

              <CustomerForm
                customerInfo={orderInfo.customerInfo}
                onCustomerInfoChange={handleCustomerInfoChange}
                rawCustomerText={rawCustomerText}
                onRawCustomerTextChange={setRawCustomerText}
                orderType={orderInfo.customerInfo.orderType}
                fieldErrors={fieldErrors}
              />
              {orderInfo.customerInfo.orderType === 'EA' && (
                <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-card p-4">
                  <ShippingMethodSelector
                    selectedMethod={orderInfo.orderShippingMethod}
                    error={fieldErrors.orderShippingMethod}
                    onMethodChange={(method, cost) => {
                      setOrderInfo(prev => ({
                        ...prev,
                        orderShippingMethod: method,
                        orderShipping: cost,
                      }));
                    }}
                  />
                </div>
              )}
            </div>

            {/* Business Info Fields */}
            {businessInfoFields.length > 0 && (
              <div className="bg-orange-50 dark:bg-orange-950/30 p-4 rounded-lg">
                <h3 className="text-lg font-semibold text-orange-800 dark:text-orange-400 mb-4">
                  🏢 Información de Negocio
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {businessInfoFields.map((field) => (
                    <div key={field.id} className="space-y-2" data-field={field.name}>
                      <label className="block text-sm font-medium text-muted-foreground">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      {field.type === 'text' && (
                        <input
                          type="text"
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required={field.required}
                        />
                      )}
                      {field.type === 'textarea' && (
                        <textarea
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          rows={3}
                          required={field.required}
                        />
                      )}
                      {field.type === 'dropdown' && (
                        <select
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required={field.required}
                        >
                          <option value="">{field.placeholder || 'Seleccionar...'}</option>
                          {field.options && JSON.parse(field.options).map((option: string) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      )}
                      {field.type === 'date' && (
                        <input
                          type="date"
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required={field.required}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Product Selection - Quick Pick */}
            <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-indigo-800 dark:text-indigo-400 mb-4 flex items-center gap-2">
                📦 Selección Rápida de Productos
              </h3>
              <EnhancedSmartSuggestions
                onProductSelect={handleProductSelect}
              />
            </div>

            {/* Products Section */}
            <div className="bg-green-50 dark:bg-green-950/30 p-4 rounded-lg" data-field="products">
              <ProductList
                orderInfo={orderInfo}
                onOrderInfoChange={handleOrderInfoChange}
                orderType={orderInfo.customerInfo.orderType}
              />
            </div>

            <fieldset className="rounded-lg border border-border p-4 space-y-3">
              <legend className="text-sm font-semibold">Estado de pago</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  { value: 'pendiente_pago', label: 'Pendiente de pago', help: 'Aún no se ha cobrado. No cuenta como ingreso cobrado.' },
                  { value: 'contra_entrega', label: 'Contra entrega', help: 'El cliente paga al recibir el producto' },
                  { value: 'pagado', label: 'Pagado', help: 'El pago ya está confirmado' },
                ] as const).map((option) => {
                  const selected = (orderInfo.paymentChoice || 'pendiente_pago') === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setOrderInfo(prev => ({
                        ...prev,
                        paymentChoice: option.value,
                        contraEntrega: option.value === 'contra_entrega',
                      }))}
                      className={`rounded-lg border-2 p-3 text-left transition-colors ${
                        selected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                          : 'border-border bg-muted/40 hover:border-muted-foreground/40'
                      }`}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Banknote className="h-4 w-4" />
                        {option.label}
                      </span>
                      <p className="mt-1 text-xs text-muted-foreground">{option.help}</p>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {Object.keys(fieldErrors).length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                <p className="font-medium mb-1">No se pudo guardar. Faltan estos datos:</p>
                <ul className="list-disc pl-4 space-y-1">
                  {Object.values(fieldErrors).map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
                disabled={isSubmitting}
                className="px-4 sm:px-6 w-full sm:w-auto"
              >
                Limpiar Formulario
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || orderInfo.products.length === 0}
                className={`px-4 sm:px-8 py-2 flex items-center justify-center gap-2 w-full sm:w-auto transition-all duration-200 ${isSubmitting
                  ? 'bg-blue-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 hover:shadow-lg'
                  } text-white`}
              >
                {isSubmitting ? (
                  <>
                    <Loader className="animate-spin" size={20} />
                    <span className="hidden sm:inline">Guardando pedido...</span>
                    <span className="sm:hidden">Guardando...</span>
                  </>
                ) : (
                  <>
                    <Save size={20} />
                    <span className="hidden sm:inline">
                      Guardar Pedido ({orderInfo.products.length} productos)
                    </span>
                    <span className="sm:hidden">
                      Guardar ({orderInfo.products.length})
                    </span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
};

export default EnhancedSalesForm;
