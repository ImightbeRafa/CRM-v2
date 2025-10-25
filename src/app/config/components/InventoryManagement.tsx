"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { 
  Package, 
  Plus, 
  Edit, 
  Trash2, 
  AlertTriangle, 
  CheckCircle, 
  TrendingUp,
  TrendingDown,
  Search,
  Filter,
  Download,
  Upload,
  BarChart3,
  Star,
  Eye,
  EyeOff
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';

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
  lastUpdated: string;
  totalSold: number;
  lastSold?: string;
  reorderPoint: number;
  reorderQuantity: number;
}

interface InventoryStats {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  topSellingItems: number;
  averageStockValue: number;
}

export function InventoryManagement() {
  const { user, loading: userLoading } = useCurrentUser();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [filteredInventory, setFilteredInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [stats, setStats] = useState<InventoryStats>({
    totalItems: 0,
    totalValue: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    topSellingItems: 0,
    averageStockValue: 0
  });

  // Form state - use empty strings for numeric fields to allow easy clearing
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    sku: '',
    currentStock: '' as string | number,
    minStock: '' as string | number,
    maxStock: '' as string | number,
    unitCost: '' as string | number,
    sellingPrice: '' as string | number,
    supplier: '',
    location: '',
    reorderPoint: '' as string | number,
    reorderQuantity: '' as string | number,
    isFavorite: false
  });

  useEffect(() => {
    loadInventory();
  }, []);

  useEffect(() => {
    filterInventory();
  }, [inventory, searchTerm, categoryFilter, stockFilter]);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/config/inventory', { credentials: 'include' });
      const result = await response.json();
      
      if (result.status === 'success') {
        setInventory(result.data);
        calculateStats(result.data);
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (items: InventoryItem[]) => {
    const totalItems = items.length;
    const totalValue = items.reduce((sum, item) => sum + (item.currentStock * item.unitCost), 0);
    const lowStockItems = items.filter(item => item.currentStock <= item.minStock).length;
    const outOfStockItems = items.filter(item => item.currentStock === 0).length;
    const topSellingItems = items.filter(item => item.totalSold > 0).length;
    const averageStockValue = totalItems > 0 ? totalValue / totalItems : 0;

    setStats({
      totalItems,
      totalValue,
      lowStockItems,
      outOfStockItems,
      topSellingItems,
      averageStockValue
    });
  };

  const filterInventory = () => {
    let filtered = inventory;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(item => item.category === categoryFilter);
    }

    // Stock filter
    if (stockFilter === 'low') {
      filtered = filtered.filter(item => item.currentStock <= item.minStock);
    } else if (stockFilter === 'out') {
      filtered = filtered.filter(item => item.currentStock === 0);
    } else if (stockFilter === 'normal') {
      filtered = filtered.filter(item => item.currentStock > item.minStock);
    }

    setFilteredInventory(filtered);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingItem ? '/api/config/inventory' : '/api/config/inventory';
      const method = editingItem ? 'PUT' : 'POST';
      const body = editingItem ? { id: editingItem.id, ...formData } : formData;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({} as any));
        console.error('Save failed:', err?.error || response.statusText);
        return;
      }

      await loadInventory();
      setShowForm(false);
      setEditingItem(null);
      resetForm();
    } catch (error) {
      console.error('Error saving inventory item:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Está seguro de que desea eliminar este artículo del inventario?')) return;
    
    try {
      const response = await fetch(`/api/config/inventory?id=${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({} as any));
        console.error('Delete failed:', err?.error || response.statusText);
        return;
      }

      await loadInventory();
    } catch (error) {
      console.error('Error deleting inventory item:', error);
    }
  };

  const handleEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description || '',
      category: item.category,
      sku: item.sku,
      currentStock: item.currentStock,
      minStock: item.minStock,
      maxStock: item.maxStock,
      unitCost: item.unitCost,
      sellingPrice: item.sellingPrice,
      supplier: item.supplier || '',
      location: item.location || '',
      reorderPoint: item.reorderPoint,
      reorderQuantity: item.reorderQuantity,
      isFavorite: item.isFavorite
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: '',
      sku: '',
      currentStock: 0,
      minStock: 0,
      maxStock: 0,
      unitCost: 0,
      sellingPrice: 0,
      supplier: '',
      location: '',
      reorderPoint: 0,
      reorderQuantity: 0,
      isFavorite: false
    });
  };

  const getStockStatus = (item: InventoryItem) => {
    if (item.currentStock === 0) return { status: 'out', color: 'bg-red-100 text-red-800', icon: AlertTriangle };
    if (item.currentStock <= item.minStock) return { status: 'low', color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle };
    return { status: 'normal', color: 'bg-green-100 text-green-800', icon: CheckCircle };
  };

  const getCategories = () => {
    const categories = [...new Set(inventory.map(item => item.category))];
    return categories;
  };

  if (userLoading || loading) {
    return <div className="p-4">Cargando inventario...</div>;
  }

  if (!user || user.role !== 'MASTER') {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-gray-500">
              Solo los usuarios MASTER pueden acceder a la gestión de inventario.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestión de Inventario</h1>
          <p className="text-gray-600">Controla el stock y precios de tus productos</p>
        </div>
        <Button
          onClick={() => {
            setEditingItem(null);
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Agregar Producto
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Productos</p>
                <p className="text-2xl font-bold">{stats.totalItems}</p>
              </div>
              <Package className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Valor Total</p>
                <p className="text-2xl font-bold">₡{stats.totalValue.toLocaleString()}</p>
              </div>
              <BarChart3 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Stock Bajo</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.lowStockItems}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Sin Stock</p>
                <p className="text-2xl font-bold text-red-600">{stats.outOfStockItems}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar productos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="all">Todas las categorías</option>
              {getCategories().map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>

            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="all">Todo el stock</option>
              <option value="normal">Stock normal</option>
              <option value="low">Stock bajo</option>
              <option value="out">Sin stock</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingItem ? 'Editar Producto' : 'Agregar Producto al Inventario'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Nombre del Producto</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="sku">SKU/Código</Label>
                  <Input
                    id="sku"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="category">Categoría</Label>
                  <Input
                    id="category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="description">Descripción</Label>
                  <Input
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="currentStock">Stock Actual</Label>
                  <Input
                    id="currentStock"
                    type="number"
                    value={formData.currentStock}
                    onChange={(e) => setFormData({ ...formData, currentStock: e.target.value })}
                    onBlur={(e) => {
                      // Convert to number on blur if empty
                      if (e.target.value === '') {
                        setFormData({ ...formData, currentStock: 0 });
                      }
                    }}
                    placeholder="0"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="minStock">Stock Mínimo</Label>
                  <Input
                    id="minStock"
                    type="number"
                    value={formData.minStock}
                    onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value === '') {
                        setFormData({ ...formData, minStock: 0 });
                      }
                    }}
                    placeholder="0"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="maxStock">Stock Máximo</Label>
                  <Input
                    id="maxStock"
                    type="number"
                    value={formData.maxStock}
                    onChange={(e) => setFormData({ ...formData, maxStock: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value === '') {
                        setFormData({ ...formData, maxStock: 0 });
                      }
                    }}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label htmlFor="unitCost">Costo Unitario</Label>
                  <Input
                    id="unitCost"
                    type="number"
                    step="0.01"
                    value={formData.unitCost}
                    onChange={(e) => setFormData({ ...formData, unitCost: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value === '') {
                        setFormData({ ...formData, unitCost: 0 });
                      }
                    }}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="sellingPrice">Precio de Venta</Label>
                  <Input
                    id="sellingPrice"
                    type="number"
                    step="0.01"
                    value={formData.sellingPrice}
                    onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value === '') {
                        setFormData({ ...formData, sellingPrice: 0 });
                      }
                    }}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="supplier">Proveedor</Label>
                  <Input
                    id="supplier"
                    value={formData.supplier}
                    onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="location">Ubicación</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="reorderPoint">Punto de Reorden</Label>
                  <Input
                    id="reorderPoint"
                    type="number"
                    value={formData.reorderPoint}
                    onChange={(e) => setFormData({ ...formData, reorderPoint: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value === '') {
                        setFormData({ ...formData, reorderPoint: 0 });
                      }
                    }}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label htmlFor="reorderQuantity">Cantidad de Reorden</Label>
                  <Input
                    id="reorderQuantity"
                    type="number"
                    value={formData.reorderQuantity}
                    onChange={(e) => setFormData({ ...formData, reorderQuantity: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value === '') {
                        setFormData({ ...formData, reorderQuantity: 0 });
                      }
                    }}
                    placeholder="0"
                  />
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isFavorite"
                  checked={formData.isFavorite}
                  onChange={(e) => setFormData({ ...formData, isFavorite: e.target.checked })}
                />
                <Label htmlFor="isFavorite">Producto Favorito</Label>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  {editingItem ? 'Actualizar' : 'Agregar'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingItem(null);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Inventory List */}
      <div className="grid gap-4">
        {filteredInventory.map((item) => {
          const stockStatus = getStockStatus(item);
          const StatusIcon = stockStatus.icon;
          
          return (
            <Card key={item.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold">{item.name}</h3>
                      {item.isFavorite && (
                        <Star className="h-4 w-4 text-yellow-500 fill-current" />
                      )}
                      <Badge className={stockStatus.color}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {stockStatus.status === 'out' ? 'Sin Stock' : 
                         stockStatus.status === 'low' ? 'Stock Bajo' : 'Stock Normal'}
                      </Badge>
                      <Badge variant="outline">{item.category}</Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">SKU:</span> {item.sku}
                      </div>
                      <div>
                        <span className="font-medium">Stock:</span> {item.currentStock}
                      </div>
                      <div>
                        <span className="font-medium">Costo:</span> ₡{item.unitCost.toLocaleString()}
                      </div>
                      <div>
                        <span className="font-medium">Precio:</span> ₡{item.sellingPrice.toLocaleString()}
                      </div>
                      {item.supplier && (
                        <div>
                          <span className="font-medium">Proveedor:</span> {item.supplier}
                        </div>
                      )}
                      {item.location && (
                        <div>
                          <span className="font-medium">Ubicación:</span> {item.location}
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Vendidos:</span> {item.totalSold}
                      </div>
                      <div>
                        <span className="font-medium">Valor Total:</span> ₡{(item.currentStock * item.unitCost).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(item)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(item.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredInventory.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No hay productos en el inventario</p>
            <Button
              onClick={() => {
                setEditingItem(null);
                resetForm();
                setShowForm(true);
              }}
              className="mt-4"
            >
              Agregar Primer Producto
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
