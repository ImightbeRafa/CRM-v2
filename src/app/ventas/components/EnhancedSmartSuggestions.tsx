import React, { useState, useEffect, useMemo } from 'react';
import { Search, Star, Package, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { ProductTemplate } from './types';
import { sfInput } from './sales-form-styles';

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
    if (item.currentStock === 0) return { status: 'out', color: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400', icon: AlertTriangle };
    if (item.currentStock <= item.minStock) return { status: 'low', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400', icon: AlertTriangle };
    return { status: 'normal', color: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400', icon: CheckCircle };
  };


  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar productos del inventario..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          className={`${sfInput()} pl-9`}
        />
      </div>

        {/* Inventory Suggestions */}
        {showSuggestions && (
          <div className="space-y-3">
            <h4 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">
              <Package className="h-3.5 w-3.5" />
              Inventario ({filteredInventory.length})
            </h4>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-slate-50/80 p-2 ring-1 ring-slate-200/60">
              {filteredInventory.length > 0 ? (
                filteredInventory.map((item) => {
                  const stockStatus = getStockStatus(item);
                  const StatusIcon = stockStatus.icon;
                  
                  return (
                    <div
                      key={item.id}
                      className="flex cursor-pointer items-center justify-between rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 transition-all hover:-translate-y-px hover:shadow-md hover:ring-[#7C5CFF]/40"
                      onClick={() => handleProductSelect(item)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{item.name}</span>
                          {item.isFavorite && (
                            <Star className="h-3 w-3 text-yellow-500 fill-current" />
                          )}
                          <Badge className={stockStatus.color}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {stockStatus.status === 'out' ? 'Sin Stock' : 
                             stockStatus.status === 'low' ? 'Stock Bajo' : 'Stock OK'}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {item.category} • SKU: {item.sku}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-4">
                          <span>Stock: {item.currentStock}</span>
                          <span>Costo: ₡{item.unitCost.toLocaleString()}</span>
                          <span>Precio: ₡{item.sellingPrice.toLocaleString()}</span>
                          {item.totalSold > 0 && (
                            <span>Vendidos: {item.totalSold}</span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="ml-2 rounded-lg border-[#7C5CFF]/30 text-au-ink-5b3fe0 hover:bg-au-tint-f1eeff">
                        Agregar
                      </Button>
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-muted-foreground py-4">
                  {searchTerm ? 'No se encontraron productos en el inventario' : 'No hay productos en el inventario'}
                </div>
              )}
            </div>

          </div>
        )}

        {/* Quick Actions */}
        {!showSuggestions && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="rounded-xl border-[#7C5CFF]/30 text-au-ink-5b3fe0 hover:bg-au-tint-f1eeff"
              onClick={() => setShowSuggestions(true)}
            >
              <Package className="h-4 w-4 mr-2" />
              Ver Productos del Inventario
            </Button>
          </div>
        )}

        {/* Stats Summary */}
        {!showSuggestions && (
          <div>
            <div className="text-[13px] text-slate-600">
              <span className="font-semibold text-slate-900">{inventoryItems.length}</span> Productos en inventario
            </div>
            <p className="mt-1 text-[12px] text-slate-500">
              El inventario es opcional. Si no hay productos guardados, puedes escribir uno a mano más abajo; no se agrega al inventario.
            </p>
          </div>
        )}
      </div>
  );
};

export default EnhancedSmartSuggestions;
