import React, { useState, useEffect, useMemo } from 'react';
import { Search, Clock, Star, TrendingUp, Package, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { ProductTemplate, CustomerSuggestion } from './types';

interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  sku: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  unitCost: number;
  sellingPrice: number;
  supplier?: string;
  location?: string;
  isActive: boolean;
  isFavorite: boolean;
  totalSold: number;
  lastSold?: string;
}

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  province: string;
  canton: string;
  district: string;
  address?: string;
  business?: string;
  username?: string;
  totalOrders: number;
  totalSpent: number;
  lastOrder: string;
  isActive: boolean;
  isFavorite: boolean;
}

interface EnhancedSmartSuggestionsProps {
  onProductSelect: (product: ProductTemplate) => void;
  onCustomerSelect: (customer: CustomerSuggestion) => void;
  currentCustomerName?: string;
}

const EnhancedSmartSuggestions: React.FC<EnhancedSmartSuggestionsProps> = ({
  onProductSelect,
  onCustomerSelect,
  currentCustomerName
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [automaticClients, setAutomaticClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);

  // Load inventory items and automatic clients from API
  useEffect(() => {
    const loadEnhancedData = async () => {
      setLoading(true);
      try {
        const [inventoryRes, clientsRes] = await Promise.all([
          fetch('/api/config/inventory', { credentials: 'include' }).then(r => r.json()),
          fetch('/api/config/automatic-clients', { credentials: 'include' }).then(r => r.json())
        ]);

        if (inventoryRes.status === 'success') {
          setInventoryItems(inventoryRes.data);
        }

        if (clientsRes.status === 'success') {
          setAutomaticClients(clientsRes.data);
        }
      } catch (error) {
        console.error('Error loading enhanced data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEnhancedData();
  }, []);

  const filteredInventory = useMemo(() => {
    if (!searchTerm) return inventoryItems;
    return inventoryItems.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, inventoryItems]);

  const filteredClients = useMemo(() => {
    if (!searchTerm) return automaticClients;
    return automaticClients.filter(client =>
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.phone.includes(searchTerm) ||
      client.business?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, automaticClients]);

  const handleProductSelect = (item: InventoryItem) => {
    const product: ProductTemplate = {
      id: item.id,
      name: item.name,
      type: item.category,
      color: '', // Will be filled by user
      tamano: '', // Will be filled by user
      baseCost: item.unitCost,
      isFavorite: item.isFavorite,
      lastUsed: new Date()
    };
    onProductSelect(product);
    setSearchTerm('');
    setShowSuggestions(false);
  };

  const handleCustomerSelect = (client: Client) => {
    const customer: CustomerSuggestion = {
      id: client.id,
      name: client.name,
      phone: client.phone,
      province: client.province,
      canton: client.canton,
      district: client.district,
      email: client.email,
      username: client.username,
      address: client.address,
      business: client.business,
      lastOrder: new Date(client.lastOrder),
      totalOrders: client.totalOrders
    };
    onCustomerSelect(customer);
    setSearchTerm('');
    setShowSuggestions(false);
  };

  const getStockStatus = (item: InventoryItem) => {
    if (item.currentStock === 0) return { status: 'out', color: 'bg-red-100 text-red-800', icon: AlertTriangle };
    if (item.currentStock <= item.minStock) return { status: 'low', color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle };
    return { status: 'normal', color: 'bg-green-100 text-green-800', icon: CheckCircle };
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
          Sugerencias Inteligentes Avanzadas
        </CardTitle>
        <p className="text-sm text-blue-600">
          Productos del inventario y clientes automáticos para acelerar la venta
        </p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar productos del inventario o clientes..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            className="w-full pl-10 pr-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Inventory Suggestions */}
        {showSuggestions && (
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-700 flex items-center gap-2">
              <Package className="h-4 w-4 text-blue-500" />
              Inventario ({filteredInventory.length})
            </h4>
            <div className="max-h-64 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
              {filteredInventory.length > 0 ? (
                filteredInventory.map((item) => {
                  const stockStatus = getStockStatus(item);
                  const StatusIcon = stockStatus.icon;
                  
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-white rounded-lg border border-blue-100 hover:border-blue-300 cursor-pointer transition-colors"
                      onClick={() => handleProductSelect(item)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          {item.isFavorite && (
                            <Star className="h-3 w-3 text-yellow-500 fill-current" />
                          )}
                          <Badge className={stockStatus.color}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {stockStatus.status === 'out' ? 'Sin Stock' : 
                             stockStatus.status === 'low' ? 'Stock Bajo' : 'Stock OK'}
                          </Badge>
                        </div>
                        <div className="text-sm text-gray-600">
                          {item.category} • SKU: {item.sku}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center gap-4">
                          <span>Stock: {item.currentStock}</span>
                          <span>Costo: ₡{item.unitCost.toLocaleString()}</span>
                          <span>Precio: ₡{item.sellingPrice.toLocaleString()}</span>
                          {item.totalSold > 0 && (
                            <span>Vendidos: {item.totalSold}</span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="ml-2">
                        Agregar
                      </Button>
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-gray-500 py-4">
                  {searchTerm ? 'No se encontraron productos en el inventario' : 'No hay productos en el inventario'}
                </div>
              )}
            </div>

            {/* Client Suggestions */}
            <h4 className="font-semibold text-gray-700 flex items-center gap-2 mt-4">
              <Users className="h-4 w-4 text-green-500" />
              Clientes Automáticos ({filteredClients.length})
            </h4>
            <div className="max-h-64 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
              {filteredClients.length > 0 ? (
                filteredClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between p-3 bg-white rounded-lg border border-green-100 hover:border-green-300 cursor-pointer transition-colors"
                    onClick={() => handleCustomerSelect(client)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{client.name}</span>
                        {client.isFavorite && (
                          <Star className="h-3 w-3 text-yellow-500 fill-current" />
                        )}
                        <Badge variant="outline" className="text-xs">
                          {client.totalOrders} pedidos
                        </Badge>
                        {client.totalSpent > 100000 && (
                          <Badge className="bg-purple-100 text-purple-800 text-xs">
                            VIP
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-gray-600">
                        {client.phone} • {client.province}, {client.canton}
                      </div>
                      {client.business && (
                        <div className="text-sm text-gray-600">
                          {client.business}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 flex items-center gap-4">
                        <span>Total gastado: ₡{client.totalSpent.toLocaleString()}</span>
                        <span>Último pedido: {formatTimeAgo(new Date(client.lastOrder))}</span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="ml-2">
                      Usar
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-4">
                  {searchTerm ? 'No se encontraron clientes' : 'No hay clientes automáticos'}
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
              <span className="hidden sm:inline">Ver Inventario</span>
              <span className="sm:hidden">Inventario</span>
            </Button>
            <Button
              variant="outline"
              className="text-green-600 border-green-200 hover:bg-green-50 w-full"
              onClick={() => setShowSuggestions(true)}
            >
              <span className="hidden sm:inline">Ver Clientes</span>
              <span className="sm:hidden">Clientes</span>
            </Button>
          </div>
        )}

        {/* Stats Summary */}
        {!showSuggestions && (
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{inventoryItems.length}</div>
              <div className="text-sm text-gray-600">Productos en Inventario</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{automaticClients.length}</div>
              <div className="text-sm text-gray-600">Clientes Automáticos</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EnhancedSmartSuggestions;
