import React, { useState, useEffect, useMemo } from 'react';
import { ProductInfo, OrderInfo } from './types';
import { Plus, Trash2, Edit3, Copy, Save, X } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import ProductForm from './productForm';
import { ShippingMethodSelector } from './ShippingMethodSelector';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';

interface ProductListProps {
  orderInfo: OrderInfo;
  onOrderInfoChange: (orderInfo: OrderInfo) => void;
  orderType: 'EA' | 'RA';
}

const ProductList: React.FC<ProductListProps> = React.memo(({
  orderInfo,
  onOrderInfoChange,
  orderType
}) => {
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [draftProduct, setDraftProduct] = useState<ProductInfo | null>(null);
  const [configFields, setConfigFields] = useState<any[]>([]);
  const [shippingMethods, setShippingMethods] = useState<Array<{id: string; name: string; basePrice: number}>>([]);
  const { user } = useCurrentUser();
  const { formatCurrency } = useTenantSettings();

  // Fetch configuration fields
  useEffect(() => {
    const fetchConfigFields = async () => {
      try {
        const response = await fetch('/api/config/fields');
        const data = await response.json();
        if (data.status === 'success') {
          setConfigFields(data.data);
        }
      } catch (error) {
        console.error('Error fetching config fields:', error);
      }
    };

    fetchConfigFields();
  }, []);

  // Helper function to get display value for a field
  const getFieldDisplayValue = (fieldKey: string, productValue: string) => {
    if (!productValue) {
      // Find the field configuration
      const field = configFields.find(f => f.key === fieldKey);
      if (field && field.optionSet && field.optionSet.options && field.optionSet.options.length > 0) {
        // Show available options count
        const optionsCount = field.optionSet.options.length;
        return `${optionsCount} opciones disponibles`;
      }
      return 'N/A';
    }
    return productValue;
  };

  // Load shipping methods from API
  useEffect(() => {
    const loadShippingMethods = async () => {
      try {
        const response = await fetch('/api/config/shipping');
        const data = await response.json();
        if (data.status === 'success') {
          setShippingMethods(data.data);
        }
      } catch (error) {
        console.error('Error loading shipping methods:', error);
      }
    };
    loadShippingMethods();
  }, []);

  // Calculate order totals
  const orderTotals = useMemo(() => {
    const subtotal = orderInfo.products.reduce((sum, product) => 
      sum + (product.productCost * product.cantidad) + (product.optionDeltas || 0), 0
    );
    
    // Use the shipping cost set by ShippingMethodSelector (already includes the priceDelta)
    // Only for EA (shipping) orders, RA (local pickup) has no shipping cost
    const shipping = orderType === 'EA' ? (orderInfo.orderShipping || 0) : 0;
    
    // Calculate IVA based on order-level setting
    const iva = orderInfo.applyOrderIVA ? subtotal * 0.13 : 0;
    const total = subtotal + shipping + iva;

    return { subtotal, shipping, iva, total };
  }, [orderInfo.products, orderInfo.orderShipping, orderInfo.applyOrderIVA, orderType]);

  // Update order totals when products change
  useEffect(() => {
    onOrderInfoChange({
      ...orderInfo,
      orderSubtotal: orderTotals.subtotal,
      orderShipping: orderTotals.shipping,
      orderIVA: orderTotals.iva,
      orderTotal: orderTotals.total
    });
  }, [orderTotals]);

  const addProduct = () => {
    // Initialize a draft product so manual inputs persist in the modal
    setDraftProduct({
      id: '',
      type: '',
      color: '',
      packaging: '',
      comments: '',
      cantidad: 1,
      productCost: 0,
      shippingCost: 0,
      iva: 0,
      total: 0,
      vendedor: user?.username || '',
      mensajeria: '',
      tamano: '',
      personalizado: '',
      optionDeltas: 0
    });
    setShowAddModal(true);
  };

  const confirmAddDraftProduct = () => {
    if (!draftProduct) return;
    const finalizedProduct: ProductInfo = {
      ...draftProduct,
      id: `product_${Date.now()}`,
      vendedor: draftProduct.vendedor || user?.username || ''
    };

    onOrderInfoChange({
      ...orderInfo,
      products: [...orderInfo.products, finalizedProduct]
    });
    setShowAddModal(false);
    setDraftProduct(null);
  };

  const removeProduct = (productId: string) => {
    onOrderInfoChange({
      ...orderInfo,
      products: orderInfo.products.filter(p => p.id !== productId)
    });
    if (editingProductId === productId) {
      setEditingProductId(null);
      setShowAddForm(false);
    }
  };

  const duplicateProduct = (productId: string) => {
    const productToDuplicate = orderInfo.products.find(p => p.id === productId);
    if (productToDuplicate) {
      const duplicatedProduct: ProductInfo = {
        ...productToDuplicate,
        id: `product_${Date.now()}`,
        comments: '' // Clear comments for new product
      };

      onOrderInfoChange({
        ...orderInfo,
        products: [...orderInfo.products, duplicatedProduct]
      });
    }
  };

  const updateProduct = (updatedProduct: ProductInfo) => {
    onOrderInfoChange({
      ...orderInfo,
      products: orderInfo.products.map(p => 
        p.id === updatedProduct.id ? updatedProduct : p
      )
    });
  };

  const startEditing = (productId: string) => {
    setEditingProductId(productId);
    setShowAddForm(true);
  };

  const stopEditing = () => {
    setEditingProductId(null);
    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Header with Add Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">
            Productos del Pedido ({orderInfo.products.length})
          </h3>
          <p className="text-sm text-gray-600">
            Agregue productos individualmente al pedido
          </p>
        </div>
        <Button
          onClick={addProduct}
          className="bg-blue-500 hover:bg-blue-600 text-white w-full sm:w-auto"
        >
          <Plus className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">Agregar Producto</span>
          <span className="sm:hidden">Agregar</span>
        </Button>
      </div>

      {/* Products List */}
      <div className="space-y-3">
        {orderInfo.products.length === 0 ? (
          <Card className="border-dashed border-2 border-gray-300">
            <CardContent className="flex flex-col items-center justify-center py-8">
              <div className="text-gray-400 mb-2">
                <Plus className="h-12 w-12 mx-auto" />
              </div>
              <p className="text-gray-500 text-center">
                No hay productos agregados al pedido
              </p>
              <p className="text-sm text-gray-400 text-center">
                Haga clic en &quot;Agregar Producto&quot; para comenzar
              </p>
            </CardContent>
          </Card>
        ) : (
          orderInfo.products.map((product, index) => (
            <Card key={product.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                  <div className="flex-1 w-full">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Badge variant="outline">#{index + 1}</Badge>
                      <span className="truncate">{product.type || 'Producto sin nombre'}</span>
                    </CardTitle>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2 text-sm text-gray-600">
                      <span className="whitespace-nowrap">Cantidad: {product.cantidad}</span>
                      <span className="whitespace-nowrap">Color: {getFieldDisplayValue('color', product.color)}</span>
                      <span className="whitespace-nowrap">Tamaño: {getFieldDisplayValue('tamano', product.tamano)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-lg font-bold text-green-600">
                      ₡{product.total.toFixed(2)}
                    </span>
                    <div className="flex gap-1 ml-auto sm:ml-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEditing(product.id)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => duplicateProduct(product.id)}
                        className="h-8 w-8 p-0"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeProduct(product.id)}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>

              {/* Product Details Summary */}
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                  <div className="flex flex-col space-y-1">
                    <span className="text-gray-500 text-xs">Costo Unitario:</span>
                    <p className="font-medium text-sm">₡{product.productCost.toFixed(2)}</p>
                  </div>
                  <div className="flex flex-col space-y-1">
                    <span className="text-gray-500 text-xs">Subtotal:</span>
                    <p className="font-medium text-sm">₡{(product.productCost * product.cantidad).toFixed(2)}</p>
                  </div>
                  {orderType === 'EA' && (
                    <div className="flex flex-col space-y-1">
                      <span className="text-gray-500 text-xs">Envío:</span>
                      <p className="font-medium text-sm">₡{product.shippingCost.toFixed(2)}</p>
                    </div>
                  )}
                  <div className="flex flex-col space-y-1">
                    <span className="text-gray-500 text-xs">IVA:</span>
                    <p className="font-medium text-sm">₡{product.iva.toFixed(2)}</p>
                  </div>
                </div>

                {/* Comments */}
                {product.comments && (
                  <div className="mt-3 p-2 bg-gray-50 rounded">
                    <span className="text-sm text-gray-500">Comentarios:</span>
                    <p className="text-sm">{product.comments}</p>
                  </div>
                )}
              </CardContent>

              {/* Edit Form Overlay */}
              {editingProductId === product.id && showAddForm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4" style={{ zIndex: 1000, position: 'absolute' }}>
                  <div className="bg-white border-2 border-blue-500 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl">
                    <div className="p-4">
                      <div className="flex justify-between items-center mb-4">
                        <h4 className="text-lg font-semibold">Editar Producto #{index + 1}</h4>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={stopEditing}
                          className="h-8 w-8 p-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <ProductForm
                        productInfo={product}
                        orderType={orderType}
                        onProductInfoChange={updateProduct}
                        applyIVA={product.iva > 0}
                        onApplyIVAChange={(applyIVA) => {
                          // Calculate IVA based on current product
                          const subtotal = product.productCost * product.cantidad;
                          const ivaAmount = applyIVA ? subtotal * 0.13 : 0;
                          const shipping = orderType === 'EA' ? product.shippingCost : 0;
                          const total = subtotal + shipping + ivaAmount;
                          
                          updateProduct({
                            ...product,
                            iva: ivaAmount,
                            total: total
                          });
                        }}
                        isAddModal={false}
                      />
                      <div className="flex justify-end gap-2 mt-4">
                        <Button
                          variant="outline"
                          onClick={stopEditing}
                        >
                          Cancelar
                        </Button>
                        <Button
                          onClick={stopEditing}
                          className="bg-blue-500 hover:bg-blue-600"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          Guardar
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))
        )}
      </div>

      {/* Order Summary */}
      {orderInfo.products.length > 0 && (
        <Card className="bg-green-50 border-green-200">
          <CardHeader>
            <CardTitle className="text-green-800">Resumen del Pedido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Order Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* IVA checkbox */}
              <div className="flex flex-col space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="applyOrderIVA"
                    checked={orderInfo.applyOrderIVA || false}
                    onChange={(e) => {
                      onOrderInfoChange({
                        ...orderInfo,
                        applyOrderIVA: e.target.checked
                      });
                    }}
                    className="w-4 h-4"
                  />
                  <label htmlFor="applyOrderIVA" className="text-sm font-medium text-gray-700">
                    Aplicar IVA (13%)
                  </label>
                </div>
              </div>

              {/* Shipping Method Selector - Only for EA orders */}
              {orderType === 'EA' && (
                <ShippingMethodSelector 
                  selectedMethod={orderInfo.orderShippingMethod}
                  onMethodChange={(method, cost) => {
                    onOrderInfoChange({
                      ...orderInfo,
                      orderShippingMethod: method,
                      orderShipping: cost
                    });
                  }}
                />
              )}
            </div>

            {/* Order Totals */}
            <div className={`grid gap-4 ${orderType === 'EA' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3'}`}>
              <div className="flex flex-col space-y-1">
                <span className="text-sm text-gray-600">Subtotal:</span>
                <p className="text-lg font-semibold">{formatCurrency(orderTotals.subtotal)}</p>
              </div>
              {/* Show shipping only for EA orders */}
              {orderType === 'EA' && (
                <div className="flex flex-col space-y-1">
                  <span className="text-sm text-gray-600">Envío:</span>
                  <p className="text-lg font-semibold">{formatCurrency(orderTotals.shipping)}</p>
                </div>
              )}
              <div className="flex flex-col space-y-1">
                <span className="text-sm text-gray-600">IVA:</span>
                <p className="text-lg font-semibold">{formatCurrency(orderTotals.iva)}</p>
              </div>
              <div className="flex flex-col space-y-1">
                <span className="text-sm text-gray-600">Total:</span>
                <p className="text-xl font-bold text-green-600">{formatCurrency(orderTotals.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Product Modal */}
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4" 
          style={{ zIndex: 1000, position: 'absolute' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddModal(false);
              setDraftProduct(null);
            }
          }}
        >
          <div className="bg-white border-2 border-blue-500 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="p-4">
              <div className="flex justify-end items-center mb-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddModal(false);
                    setDraftProduct(null);
                  }}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <ProductForm
                productInfo={draftProduct as ProductInfo}
                orderType={orderType}
                onProductInfoChange={(newProduct) => setDraftProduct(newProduct)}
                applyIVA={(draftProduct?.iva || 0) > 0}
                onApplyIVAChange={(applyIVA) => {
                  if (!draftProduct) return;
                  const subtotal = draftProduct.productCost * draftProduct.cantidad;
                  const ivaAmount = applyIVA ? subtotal * 0.13 : 0;
                  const shipping = orderType === 'EA' ? draftProduct.shippingCost : 0;
                  const total = subtotal + shipping + ivaAmount;
                  setDraftProduct({
                    ...draftProduct,
                    iva: ivaAmount,
                    total
                  });
                }}
                isAddModal={true}
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddModal(false);
                    setDraftProduct(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={confirmAddDraftProduct}
                  className="bg-blue-500 hover:bg-blue-600"
                  disabled={!draftProduct || !(draftProduct.type && draftProduct.type.trim().length > 0)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Producto
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

ProductList.displayName = 'ProductList';

export default ProductList;
