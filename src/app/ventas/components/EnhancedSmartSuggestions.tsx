import React, { useState, useEffect, useMemo } from 'react';
import { Search, Star, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { ProductTemplate } from './types';

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

interface EnhancedSmartSuggestionsProps {
  onProductSelect: (product: ProductTemplate) => void;
}

const EnhancedSmartSuggestions: React.FC<EnhancedSmartSuggestionsProps> = ({
  onProductSelect
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Load inventory items from API
  useEffect(() => {
    const loadInventory = async () => {
      setLoading(true);
      try {
        const inventoryRes = await fetch('/api/config/inventory', { credentials: 'include' });
        const data = await inventoryRes.json();

        if (data.status === 'success') {
          setInventoryItems(data.data);
        }
      } catch (error) {
        console.error('Error loading inventory:', error);
      } finally {
        setLoading(false);
      }
    };

    loadInventory();
  }, []);

  const filteredInventory = useMemo(() => {
    if (!searchTerm) return inventoryItems;
    return inventoryItems.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, inventoryItems]);

  const handleProductSelect = (item: InventoryItem) => {
    const product: ProductTemplate = {
      id: item.id,
      name: item.name,
      type: item.category,
      color: '', // Will be filled by user
      tamano: '', // Will be filled by user
      baseCost: item.sellingPrice,
      isFavorite: item.isFavorite,
      lastUsed: new Date()
    };
    onProductSelect(product);
    setSearchTerm('');
    setShowSuggestions(false);
  };


  const getStockStatus = (item: InventoryItem) => {
    if (item.currentStock === 0) return { status: 'out', color: 'bg-red-100 text-red-800', icon: AlertTriangle };
    if (item.currentStock <= item.minStock) return { status: 'low', color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle };
    return { status: 'normal', color: 'bg-green-100 text-green-800', icon: CheckCircle };
  };


  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar productos del inventario..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          className="w-full pl-10 pr-4 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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

          </div>
        )}

        {/* Quick Actions */}
        {!showSuggestions && (
          <div className="text-center">
            <Button
              variant="outline"
              className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
              onClick={() => setShowSuggestions(true)}
            >
              <Package className="h-4 w-4 mr-2" />
              Ver Productos del Inventario
            </Button>
          </div>
        )}

        {/* Stats Summary */}
        {!showSuggestions && (
          <div className="text-center pt-4 border-t border-gray-200">
            <div className="text-2xl font-bold text-indigo-600">{inventoryItems.length}</div>
            <div className="text-sm text-gray-600">Productos en Inventario</div>
          </div>
        )}
      </div>
  );
};

export default EnhancedSmartSuggestions;
