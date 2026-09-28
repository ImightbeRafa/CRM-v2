import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { Building2, Package, UserRound } from 'lucide-react';
import { sfInput, sfLabel, sfPanel, sfSection } from './sales-form-styles';
import { DRAFT_MAX_AGE_MS, orderDraftStorageKey } from '@/lib/order-draft';

export interface CreatedOrderRef {
  /** `Order.id` (cuid), when the API returned it. */
  id?: string;
  /** Public order id (e.g. `ORDER-123…`). */
  orderId: string;
}

export interface OrderFormPrefill {
  name?: string;
  phone?: string;
  username?: string;
}

interface EnhancedSalesFormProps {
  showOrderForm: boolean;
  onToggleForm: (show: boolean) => void;
  /** Called once after the order was created (drawer / chat hand-off). */
  onCreated?: (order: CreatedOrderRef) => void | Promise<void>;
  /** Initial customer data (e.g. from a chat). Applied only to empty fields; skips the autosaved draft. */
  prefill?: OrderFormPrefill;
  /** Rendered inside a drawer that already provides the frame and the close button. */
  embedded?: boolean;
  /**
   * Own draft slot (e.g. `chat:<id>`): the unfinished order is kept per chat and
   * restored when the chat's "Crear pedido" opens again. Without it the /ventas draft is used.
   */
  draftKey?: string;
}

/** Section heading with an Aurora icon badge (presentation only). */
function SalesSectionTitle({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-au-tint-eef0ff to-au-tint-f6f4ff text-au-ink-5b3fe0 ring-1 ring-au-line-e4deff">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-8 text-slate-900">{title}</h3>
        {subtitle ? <p className="-mt-1 text-[12px] text-slate-500">{subtitle}</p> : null}
      </div>
    </div>
  )
}

const EnhancedSalesForm: React.FC<EnhancedSalesFormProps> = ({ showOrderForm, onToggleForm, onCreated, prefill, embedded = false, draftKey }) => {
  const prefillRef = useRef(prefill);
  const storageKey = orderDraftStorageKey(draftKey);
  const storageKeyRef = useRef(storageKey);
  const prefillAppliedRef = useRef(false);
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
  // Synchronous guard: a double click / double Enter fires before isSubmitting re-renders.
  const submittingRef = useRef(false);
  // One id per draft: a retry after a lost response re-sends the same order instead of a new one.
  const draftOrderIdRef = useRef<string | null>(null);
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
        localStorage.setItem(storageKeyRef.current, JSON.stringify(autoSaveData));
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

  // Per-chat draft: saved quietly shortly after each change and when the drawer closes, so
  // switching chats never loses a half-filled order.
  const latestDraftRef = useRef<{ customerInfo: OrderInfo['customerInfo']; products: OrderInfo['products'] } | null>(null);
  latestDraftRef.current = { customerInfo: orderInfo.customerInfo, products: orderInfo.products };
  const submittedRef = useRef(false);
  const writeChatDraft = useCallback(() => {
    const latest = latestDraftRef.current;
    if (!draftKey || submittedRef.current || !latest) return;
    if (latest.products.length === 0 && !latest.customerInfo.address && !latest.customerInfo.province) return;
    try {
      localStorage.setItem(
        storageKeyRef.current,
        JSON.stringify({ customerInfo: latest.customerInfo, products: latest.products, timestamp: new Date().toISOString() }),
      );
    } catch {
      // ignore (private mode / quota)
    }
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey || !isClient) return;
    const t = setTimeout(writeChatDraft, 600);
    return () => clearTimeout(t);
  }, [draftKey, isClient, orderInfo, writeChatDraft]);
  useEffect(() => () => writeChatDraft(), [writeChatDraft]);

  // Load auto-saved data on component mount
  useEffect(() => {
    if (!isClient) return;
    // A prefilled form without its own draft slot starts fresh so another customer's draft
    // never leaks in. A chat's own slot (`draftKey`) always belongs to that chat.
    if (prefillRef.current && !draftKey) return;

    const savedData = localStorage.getItem(storageKeyRef.current);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        const age = Date.now() - new Date(parsed.timestamp || 0).getTime();
        if (draftKey && !(age >= 0 && age < DRAFT_MAX_AGE_MS)) {
          localStorage.removeItem(storageKeyRef.current);
          return;
        }
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
  }, [isClient, draftKey]);

  // Apply the prefill once, only to empty fields
  useEffect(() => {
    if (!isClient || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    const initial = prefillRef.current;
    if (!initial) return;
    setOrderInfo(prev => ({
      ...prev,
      customerInfo: {
        ...prev.customerInfo,
        name: prev.customerInfo.name || initial.name || '',
        phone: prev.customerInfo.phone || initial.phone || '',
        username: prev.customerInfo.username || initial.username || '',
      },
    }));
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

    if (submittingRef.current) return;
    submittingRef.current = true;
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
        orderId: (draftOrderIdRef.current ??= `ORDER-${Date.now()}`),
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

      let response: Response;
      try {
        response = await fetch('/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `ventas:create:${orderData.orderId}`,
          },
          credentials: 'include',
          body: JSON.stringify(orderData),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (networkError) {
        // Retrying re-sends the same order id, so it cannot create a duplicate.
        throw new Error(
          networkError instanceof Error && networkError.name === 'TimeoutError'
            ? 'La conexión tardó demasiado. Puede que el pedido se haya guardado: revisá la lista o volvé a tocar Guardar (no se duplica).'
            : 'No hay conexión con el servidor. Volvé a tocar Guardar (no se duplica).'
        );
      }

      if (!response.ok) {
        // Gateway errors (502/524) return HTML, not JSON.
        const errorData = await response.json().catch(() => ({} as Record<string, string>));
        throw new Error(
          errorData.error || errorData.message ||
          (response.status >= 500
            ? 'El servidor no respondió bien. Puede que el pedido se haya guardado: revisá la lista o volvé a tocar Guardar (no se duplica).'
            : 'Error al guardar el pedido')
        );
      }

      const result = await response.json();

      // The order is saved: never make the seller wait on customer bookkeeping.
      // Update (or create) this customer and its order stats in the background; the full
      // tenant-wide client sync used to run here and could take minutes on large accounts.
      void fetch('/api/config/automatic-clients/update-from-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
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
      }).catch((clientUpdateError) => {
        console.error('Failed to update client record:', clientUpdateError);
      });

      setSubmitStatus({
        type: 'success',
        message: `✅ Pedido guardado exitosamente con ${orderInfo.products.length} producto(s) - ID: ${result.data.orderId}`
      });

      // Clear auto-save data after successful submission
      submittedRef.current = true;
      localStorage.removeItem(storageKeyRef.current);

      // Auto-hide success message after 5 seconds
      const timeoutId = setTimeout(() => {
        if (isMounted) {
          setSubmitStatus({ type: '', message: '' });
        }
      }, 5000);

      // Store timeout ID for cleanup
      (window as any).__betsy_success_timeout = timeoutId;

      resetForm();

      if (onCreated) {
        try {
          await onCreated({ id: result.data?.id, orderId: result.data?.orderId });
        } catch (hookError) {
          // The order already exists; a hand-off failure must never look like a failed save.
          console.warn('onCreated hand-off failed:', hookError);
        }
      }

    } catch (error) {
      setSubmitStatus({
        type: 'error',
        message: error instanceof Error
          ? `❌ Error: ${error.message}`
          : '❌ Error al guardar el pedido. Por favor intente de nuevo.'
      });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    draftOrderIdRef.current = null;
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
      localStorage.removeItem(storageKeyRef.current);
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
      <Card
        role="main"
        aria-label="Nuevo pedido"
        className={embedded ? 'border-0 bg-transparent shadow-none' : undefined}
      >
        <CardHeader className={embedded ? 'px-0 pb-4 pt-0' : undefined}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <CardTitle className="flex items-center gap-2 text-[20px] font-semibold tracking-tight text-slate-900">
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
                {!embedded && (
                  <Button
                    onClick={() => onToggleForm(false)}
                    variant="outline"
                    size="sm"
                    className="ml-2"
                  >
                    Cerrar
                  </Button>
                )}
              </div>
              <p className="mt-1 min-h-[1rem] text-[12px] text-slate-500" aria-live="polite">
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

        <CardContent className={embedded ? 'px-0 pb-0' : undefined}>
          {submitStatus.message && (
            <Alert
              className={`mb-4 rounded-xl ${submitStatus.type === 'success' ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800/50' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50'
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
          <p className="mb-4 text-[12px] text-slate-500">Los campos con <span className="text-red-500">*</span> son obligatorios.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Customer Information */}
            <div className={sfSection}>
              <SalesSectionTitle icon={UserRound} title="Información del Cliente" />

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
                <div className={`mt-4 ${sfPanel}`}>
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
              <div className={sfSection}>
                <SalesSectionTitle icon={Building2} title="Información de Negocio" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {businessInfoFields.map((field) => (
                    <div key={field.id} data-field={field.name}>
                      <label htmlFor={`bizfield-${field.id}`} className={sfLabel}>
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      {field.type === 'text' && (
                        <input
                          type="text"
                          id={`bizfield-${field.id}`}
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          placeholder={field.placeholder}
                          className={sfInput()}
                          required={field.required}
                        />
                      )}
                      {field.type === 'textarea' && (
                        <textarea
                          id={`bizfield-${field.id}`}
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          placeholder={field.placeholder}
                          className={sfInput()}
                          rows={3}
                          required={field.required}
                        />
                      )}
                      {field.type === 'dropdown' && (
                        <select
                          id={`bizfield-${field.id}`}
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          className={sfInput()}
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
                          id={`bizfield-${field.id}`}
                          value={orderInfo.customerInfo[field.name] || ''}
                          onChange={(e) => handleCustomerInfoChange({
                            ...orderInfo.customerInfo,
                            [field.name]: e.target.value
                          })}
                          className={sfInput()}
                          required={field.required}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Products: quick pick from inventory + the order lines */}
            <div className={sfSection} data-field="products">
              <SalesSectionTitle
                icon={Package}
                title="Selección Rápida de Productos"
                subtitle="Elegí del inventario o agregá un producto a mano."
              />
              <EnhancedSmartSuggestions
                onProductSelect={handleProductSelect}
              />
              <div className="my-5 border-t border-dashed border-slate-200" />
              <ProductList
                orderInfo={orderInfo}
                onOrderInfoChange={handleOrderInfoChange}
                orderType={orderInfo.customerInfo.orderType}
              />
            </div>

            <fieldset className={sfSection}>
              <legend className="sr-only">Estado de pago</legend>
              <SalesSectionTitle icon={Banknote} title="Estado de pago" />
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
                      aria-pressed={selected}
                      className={`rounded-xl p-3 text-left transition-all ${
                        selected
                          ? 'bg-au-tint-f6f4ff shadow-sm ring-2 ring-[#7C5CFF]'
                          : 'bg-white ring-1 ring-slate-200 hover:-translate-y-px hover:ring-slate-300'
                      }`}
                    >
                      <span className={`flex items-center gap-2 text-[13px] font-semibold ${selected ? 'text-au-ink-5b3fe0' : 'text-slate-800'}`}>
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-full ring-2 ${selected ? 'bg-[#7C5CFF] ring-[#7C5CFF]' : 'ring-slate-300'}`}
                          aria-hidden
                        >
                          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                        </span>
                        {option.label}
                      </span>
                      <p className="mt-1 text-[12px] leading-snug text-slate-500">{option.help}</p>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {Object.keys(fieldErrors).length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                <p className="font-medium mb-1">No se pudo guardar. Faltan estos datos:</p>
                <ul className="list-disc pl-4 space-y-1">
                  {Object.values(fieldErrors).map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Submit bar: sticks to the bottom of the drawer while scrolling */}
            <div
              className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3 ${
                embedded
                  ? 'sticky bottom-0 z-10 -mx-4 border-t border-slate-200/70 bg-white/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-5 sm:px-5'
                  : ''
              }`}
            >
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
                disabled={isSubmitting}
                className="w-full rounded-xl border-slate-200 px-4 text-slate-700 hover:bg-slate-50 sm:w-auto sm:px-6"
              >
                Limpiar Formulario
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || orderInfo.products.length === 0}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 shadow-sm transition-all duration-200 sm:w-auto sm:px-8 ${isSubmitting
                  ? 'cursor-not-allowed bg-[#5B6CFF]/60'
                  : 'bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] hover:opacity-90 hover:shadow-lg'
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
