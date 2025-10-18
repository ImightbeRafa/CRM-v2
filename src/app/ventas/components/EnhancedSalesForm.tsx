import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Save, Loader, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import OrderTypeToggle from './OrderTypeToggle';
import CustomerForm from './customerForm';
import ProductList from './ProductList';
import SmartSuggestions from './SmartSuggestions';
import { CustomerInfo, ProductInfo, OrderInfo, SubmitStatus, ProductTemplate, CustomerSuggestion } from './types';
import { useCurrentUser } from '../../hooks/useCurrentUser';

const EnhancedSalesForm = () => {
  const { user } = useCurrentUser();
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
      fechaEsperada: '',
      fechaAcordada: '',
      fechaRetirada: '',
      diaVenta: '',
      orderType: 'EA',
    },
    products: [],
    orderTotal: 0,
    orderIVA: 0,
    orderSubtotal: 0,
    orderShipping: 0,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ type: '', message: '' });
  const [rawCustomerText, setRawCustomerText] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Auto-assign vendedor to products that don't have one
  useEffect(() => {
    if (user && orderInfo.products.some(p => !p.vendedor.trim())) {
      setOrderInfo(prev => ({
        ...prev,
        products: prev.products.map(product => ({
          ...product,
          vendedor: product.vendedor || user.username
        }))
      }));
    }
  }, [user, orderInfo.products]);

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
    if (!isClient) return;
    const interval = setInterval(autoSave, 30000);
    return () => clearInterval(interval);
  }, [autoSave, isClient]);

  // Load auto-saved data on component mount
  useEffect(() => {
    if (!isClient) return;
    
    const savedData = localStorage.getItem('betsy_autosave');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.customerInfo || parsed.products?.length > 0) {
          setOrderInfo(prev => ({
            ...prev,
            customerInfo: { ...prev.customerInfo, ...parsed.customerInfo },
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

  const validateForm = (): string | null => {
    // Validate customer info
    if (!orderInfo.customerInfo.name.trim()) {
      return 'El nombre del cliente es requerido';
    }
    if (!orderInfo.customerInfo.phone.trim()) {
      return 'El teléfono del cliente es requerido';
    }
    if (!orderInfo.customerInfo.province.trim()) {
      return 'La provincia es requerida';
    }
    if (!orderInfo.customerInfo.canton.trim()) {
      return 'El cantón es requerido';
    }
    if (!orderInfo.customerInfo.district.trim()) {
      return 'El distrito es requerido';
    }

    // Validate products
    if (orderInfo.products.length === 0) {
      return 'Debe agregar al menos un producto al pedido';
    }

    for (let i = 0; i < orderInfo.products.length; i++) {
      const product = orderInfo.products[i];
      if (!product.type.trim()) {
        return `El tipo de producto #${i + 1} es requerido`;
      }
      if (product.cantidad <= 0) {
        return `La cantidad del producto #${i + 1} debe ser mayor a 0`;
      }
      if (product.productCost <= 0) {
        return `El costo del producto #${i + 1} debe ser mayor a 0`;
      }
      if (!product.vendedor.trim()) {
        return `El vendedor del producto #${i + 1} es requerido`;
      }
    }

    // Validate EA-specific fields
    if (orderInfo.customerInfo.orderType === 'EA') {
      if (!orderInfo.customerInfo.fechaEsperada.trim()) {
        return 'La fecha esperada es requerida para pedidos EA';
      }
    }

    // Validate RA-specific fields
    if (orderInfo.customerInfo.orderType === 'RA') {
      if (!orderInfo.customerInfo.fechaAcordada.trim()) {
        return 'La fecha acordada es requerida para pedidos RA';
      }
    }

    // Validate order-level shipping method
    if (!orderInfo.orderShippingMethod?.trim()) {
      return 'La mensajería del pedido es requerida';
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Validate form before submission
    const validationError = validateForm();
    if (validationError) {
      setSubmitStatus({
        type: 'error',
        message: validationError
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus({ type: '', message: '' });

    try {
      // Create order data for database
      const orderData = {
        orderId: `ORDER-${Date.now()}`,
        orderType: 'EA',
        status: 'Pendiente',
        customerName: orderInfo.customerInfo.name,
        username: orderInfo.customerInfo.username || '',
        phone: orderInfo.customerInfo.phone || '',
        email: orderInfo.customerInfo.email || '',
        business: orderInfo.customerInfo.business || '',
        product: orderInfo.products.map(p => p.type).join(', '),
        quantity: orderInfo.products.reduce((sum, p) => sum + p.cantidad, 0),
        total: orderInfo.orderTotal,
        iva: orderInfo.orderIVA,
        shippingCost: orderInfo.orderShipping,
        address: orderInfo.customerInfo.address || '',
        province: orderInfo.customerInfo.province || '',
        canton: orderInfo.customerInfo.canton || '',
        district: orderInfo.customerInfo.district || '',
        courier: orderInfo.orderShippingMethod,
        comments: orderInfo.products.map(p => 
          `${p.type} (${p.cantidad}x) - ${p.color || 'N/A'} - ${p.tamano || 'N/A'}`
        ).join('; '),
        timestamp: new Date(),
        saleDate: new Date().toISOString()
      };

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al guardar el pedido');
      }

      const result = await response.json();

      setSubmitStatus({
        type: 'success',
        message: `✅ Pedido guardado exitosamente con ${orderInfo.products.length} producto(s) - ID: ${result.data.orderId}`
      });
      
      // Clear auto-save data after successful submission
      localStorage.removeItem('betsy_autosave');
      
      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setSubmitStatus({ type: '', message: '' });
      }, 5000);
      
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
        fechaEsperada: '',
        fechaAcordada: '',
        fechaRetirada: '',
        diaVenta: isClient ? new Date().toISOString().split('T')[0] : '',
        orderType: 'EA',
      },
      products: [],
      orderTotal: 0,
      orderIVA: 0,
      orderSubtotal: 0,
      orderShipping: 0,
    });
    
    setRawCustomerText('');
    setAutoSaveStatus('saved');
    setLastAutoSave(null);
    
    // Clear localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('betsy_autosave');
    }
  };

  const handleOrderInfoChange = (newOrderInfo: OrderInfo) => {
    setOrderInfo(newOrderInfo);
  };

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
    setOrderInfo(prev => ({
      ...prev,
      customerInfo: {
        ...prev.customerInfo,
        name: customerSuggestion.name,
        phone: customerSuggestion.phone,
        province: customerSuggestion.province,
        canton: customerSuggestion.canton,
        district: customerSuggestion.district
      }
    }));
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-2 sm:p-4">
      <Card role="main" aria-label="Formulario de Ventas Optimizado">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center gap-2">
                Betsy - Sistema de Ventas Optimizado
                {autoSaveStatus === 'saving' && (
                  <Clock className="h-4 w-4 text-blue-500 animate-spin" />
                )}
                {autoSaveStatus === 'saved' && lastAutoSave && (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                )}
                {autoSaveStatus === 'unsaved' && (
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                )}
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
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
                  customerInfo: { ...prev.customerInfo, orderType: type }
                }))
              }
            />
          </div>
        </CardHeader>
        
        <CardContent>
          {submitStatus.message && (
            <Alert 
              className={`mb-4 ${
                submitStatus.type === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              }`}
            >
              <AlertTitle className={submitStatus.type === 'success' ? 'text-green-800' : 'text-red-800'}>
                {submitStatus.type === 'success' ? 'Éxito' : 'Error'}
              </AlertTitle>
              <AlertDescription className={submitStatus.type === 'success' ? 'text-green-700' : 'text-red-700'}>
                {submitStatus.message}
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Customer Information */}
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-blue-800 mb-4">
                👤 Información del Cliente
              </h3>
              <CustomerForm
                customerInfo={orderInfo.customerInfo}
                onCustomerInfoChange={handleCustomerInfoChange}
                rawCustomerText={rawCustomerText}
                onRawCustomerTextChange={setRawCustomerText}
                orderType={orderInfo.customerInfo.orderType}
              />
            </div>
            
            {/* Smart Suggestions */}
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-lg">
              <SmartSuggestions
                onProductSelect={handleProductSelect}
                onCustomerSelect={handleCustomerSelect}
                currentCustomerName={orderInfo.customerInfo.name}
              />
            </div>

            {/* Products Section */}
            <div className="bg-green-50 p-4 rounded-lg">
              <ProductList
                orderInfo={orderInfo}
                onOrderInfoChange={handleOrderInfoChange}
                orderType={orderInfo.customerInfo.orderType}
              />
            </div>

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
                className={`px-4 sm:px-8 py-2 flex items-center justify-center gap-2 w-full sm:w-auto transition-all duration-200 ${
                  isSubmitting 
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
    </div>
  );
};

export default EnhancedSalesForm;
