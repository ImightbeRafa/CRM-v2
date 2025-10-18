import React, { useState, useEffect, useMemo } from 'react';
import { Search, Clock, Star, TrendingUp } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { ProductTemplate, CustomerSuggestion } from './types';

interface SmartSuggestionsProps {
  onProductSelect: (product: ProductTemplate) => void;
  onCustomerSelect: (customer: CustomerSuggestion) => void;
  currentCustomerName?: string;
}

const SmartSuggestions: React.FC<SmartSuggestionsProps> = ({
  onProductSelect,
  onCustomerSelect,
  currentCustomerName
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentProducts, setRecentProducts] = useState<ProductTemplate[]>([]);
  const [recentCustomers, setRecentCustomers] = useState<CustomerSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  // Load frequent products and customers from API
  useEffect(() => {
    const loadFrequentData = async () => {
      setLoading(true);
      try {
        const [productsRes, customersRes] = await Promise.all([
          fetch('/api/config/frequent-products', { credentials: 'include' }).then(r => r.json()),
          fetch('/api/config/frequent-customers', { credentials: 'include' }).then(r => r.json())
        ]);

        if (productsRes.status === 'success') {
          const products = productsRes.data.map((product: any) => ({
            id: product.id,
            name: product.name,
            type: product.type,
            color: product.color,
            tamano: product.tamano,
            baseCost: product.baseCost,
            isFavorite: product.isFavorite,
            lastUsed: new Date(product.lastUsed)
          }));
          setRecentProducts(products);
        }

        if (customersRes.status === 'success') {
          const customers = customersRes.data.map((customer: any) => ({
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            province: customer.province,
            canton: customer.canton,
            district: customer.district,
            email: customer.email,
            username: customer.username,
            address: customer.address,
            business: customer.business,
            lastOrder: new Date(customer.lastOrder),
            totalOrders: customer.totalOrders
          }));
          setRecentCustomers(customers);
        }
      } catch (error) {
        console.error('Error loading frequent data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFrequentData();
  }, []);

  const filteredProducts = useMemo(() => {
    if (!searchTerm) return recentProducts;
    return recentProducts.filter(product =>
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.type.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, recentProducts]);

  const filteredCustomers = useMemo(() => {
    if (!searchTerm) return recentCustomers;
    return recentCustomers.filter(customer =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone.includes(searchTerm)
    );
  }, [searchTerm, recentCustomers]);

  const handleProductSelect = (product: ProductTemplate) => {
    onProductSelect(product);
    setSearchTerm('');
    setShowSuggestions(false);
  };

  const handleCustomerSelect = (customer: CustomerSuggestion) => {
    onCustomerSelect(customer);
    setSearchTerm('');
    setShowSuggestions(false);
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Hace menos de 1 hora';
    if (diffInHours < 24) return `Hace ${diffInHours} hora${diffInHours > 1 ? 's' : ''}`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `Hace ${diffInDays} día${diffInDays > 1 ? 's' : ''}`;
    
    const diffInWeeks = Math.floor(diffInDays / 7);
    return `Hace ${diffInWeeks} semana${diffInWeeks > 1 ? 's' : ''}`;
  };

  return (
    <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
      <CardHeader>
        <CardTitle className="text-blue-800 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Sugerencias Inteligentes
        </CardTitle>
        <p className="text-sm text-blue-600">
          Productos y clientes frecuentes para acelerar la venta
        </p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar productos o clientes..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            className="w-full pl-10 pr-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Product Suggestions */}
        {showSuggestions && (
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-700 flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" />
              Productos Frecuentes ({filteredProducts.length})
            </h4>
            <div className="max-h-64 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
              {filteredProducts.length > 0 ? (
                filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-3 bg-white rounded-lg border border-blue-100 hover:border-blue-300 cursor-pointer transition-colors"
                  onClick={() => handleProductSelect(product)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{product.name}</span>
                      {product.isFavorite && (
                        <Star className="h-3 w-3 text-yellow-500 fill-current" />
                      )}
                    </div>
                    <div className="text-sm text-gray-600">
                      {product.type} • {product.color} • {product.tamano}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTimeAgo(product.lastUsed!)} • ₡{product.baseCost.toLocaleString()}
                    </div>
                  </div>
                    <Button size="sm" variant="outline" className="ml-2">
                      Agregar
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-4">
                  {searchTerm ? 'No se encontraron productos' : 'No hay productos frecuentes'}
                </div>
              )}
            </div>

            {/* Customer Suggestions */}
            <h4 className="font-semibold text-gray-700 flex items-center gap-2 mt-4">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Clientes Frecuentes ({filteredCustomers.length})
            </h4>
            <div className="max-h-64 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
              {filteredCustomers.length > 0 ? (
                filteredCustomers.map((customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between p-3 bg-white rounded-lg border border-green-100 hover:border-green-300 cursor-pointer transition-colors"
                  onClick={() => handleCustomerSelect(customer)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{customer.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {customer.totalOrders} pedidos
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-600">
                      {customer.phone} • {customer.province}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Último pedido: {formatTimeAgo(customer.lastOrder!)}
                    </div>
                  </div>
                    <Button size="sm" variant="outline" className="ml-2">
                      Usar
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-4">
                  {searchTerm ? 'No se encontraron clientes' : 'No hay clientes frecuentes'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        {!showSuggestions && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="text-blue-600 border-blue-200 hover:bg-blue-50 w-full"
              onClick={() => setShowSuggestions(true)}
            >
              <span className="hidden sm:inline">Ver Productos Frecuentes</span>
              <span className="sm:hidden">Productos Frecuentes</span>
            </Button>
            <Button
              variant="outline"
              className="text-green-600 border-green-200 hover:bg-green-50 w-full"
              onClick={() => setShowSuggestions(true)}
            >
              <span className="hidden sm:inline">Ver Clientes Frecuentes</span>
              <span className="sm:hidden">Clientes Frecuentes</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SmartSuggestions;
