"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Textarea } from '@/app/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/app/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import {
  Package,
  Plus,
  Edit,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Search,
  BarChart3,
  Star,
  ChevronDown,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/app/hooks/use-toast';

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
}

const INITIAL_FORM = {
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
  isFavorite: false,
};

function generateSKU(name: string, category: string): string {
  const prefix = (category || name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 3)
    .toUpperCase();
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

function getMargin(cost: number, price: number): number | null {
  if (!price || price <= 0) return null;
  return Math.round(((price - cost) / price) * 100);
}

function getStockStatus(item: InventoryItem) {
  if (item.currentStock === 0)
    return { label: 'Sin Stock', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: AlertTriangle };
  if (item.currentStock <= item.minStock)
    return { label: 'Stock Bajo', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', icon: AlertTriangle };
  return { label: 'Normal', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle };
}

export function InventoryManagement() {
  const { toast } = useToast();

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');

  const [formData, setFormData] = useState(INITIAL_FORM);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  // Pagination for large catalogs (Excel imports can easily produce 300+ items)
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => { loadInventory(); }, []);

  // Unique categories for the Select dropdown. We MUST exclude empty-string
  // values because Radix <Select.Item> throws a hard runtime error on value="",
  // which previously crashed the whole page after bulk imports without a
  // "categoria" column.
  const categories = useMemo(
    () => [...new Set(inventory.map(i => (i.category || '').trim()).filter(Boolean))].sort(),
    [inventory]
  );

  const stats = useMemo<InventoryStats>(() => {
    const totalItems = inventory.length;
    const totalValue = inventory.reduce((s, i) => s + i.currentStock * i.unitCost, 0);
    const lowStockItems = inventory.filter(i => i.currentStock > 0 && i.currentStock <= i.minStock).length;
    const outOfStockItems = inventory.filter(i => i.currentStock === 0).length;
    return { totalItems, totalValue, lowStockItems, outOfStockItems };
  }, [inventory]);

  const filteredInventory = useMemo(() => {
    let filtered = inventory;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(i => i.category === categoryFilter);
    }
    if (stockFilter === 'low') filtered = filtered.filter(i => i.currentStock > 0 && i.currentStock <= i.minStock);
    else if (stockFilter === 'out') filtered = filtered.filter(i => i.currentStock === 0);
    else if (stockFilter === 'normal') filtered = filtered.filter(i => i.currentStock > i.minStock);
    return filtered;
  }, [inventory, searchTerm, categoryFilter, stockFilter]);

  // Reset page when filters change so the user never lands on a blank page.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, categoryFilter, stockFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredInventory.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedInventory = useMemo(
    () => filteredInventory.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredInventory, currentPage]
  );
  const firstItemIndex = filteredInventory.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastItemIndex = Math.min(currentPage * PAGE_SIZE, filteredInventory.length);

  const margin = useMemo(() => {
    const cost = Number(formData.unitCost) || 0;
    const price = Number(formData.sellingPrice) || 0;
    return getMargin(cost, price);
  }, [formData.unitCost, formData.sellingPrice]);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config/inventory', { credentials: 'include' });
      const result = await res.json();
      if (result.status === 'success') setInventory(result.data);
    } catch {
      toast({ title: 'Error', description: 'No se pudo cargar el inventario', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingItem(null);
    setFormData({ ...INITIAL_FORM });
    setShowAdvanced(false);
    setIsCreatingCategory(false);
    setShowForm(true);
  };

  const openEdit = (item: InventoryItem) => {
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
      isFavorite: item.isFavorite,
    });
    const hasAdvanced = !!(item.supplier || item.location || item.minStock || item.maxStock || item.reorderPoint || item.reorderQuantity);
    setShowAdvanced(hasAdvanced);
    setIsCreatingCategory(false);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const method = editingItem ? 'PUT' : 'POST';
      const body = editingItem ? { id: editingItem.id, ...formData } : formData;
      const res = await fetch('/api/config/inventory', {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: 'Error al guardar',
          description: (err as any)?.error === 'SKU already exists' ? 'Ya existe un producto con ese SKU' : 'No se pudo guardar el producto',
          variant: 'destructive',
        });
        return;
      }

      toast({ title: editingItem ? 'Producto actualizado' : 'Producto creado', description: formData.name });
      setShowForm(false);
      setEditingItem(null);
      await loadInventory();
    } catch {
      toast({ title: 'Error', description: 'No se pudo guardar el producto', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/config/inventory?id=${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        toast({ title: 'Error', description: 'No se pudo eliminar el producto', variant: 'destructive' });
        return;
      }
      toast({ title: 'Producto eliminado', description: deleteTarget.name });
      setDeleteTarget(null);
      await loadInventory();
    } catch {
      toast({ title: 'Error', description: 'No se pudo eliminar el producto', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const updateField = <K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
        <span className="text-muted-foreground">Cargando inventario...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestión de Inventario</h1>
          <p className="text-muted-foreground">Controla el stock y precios de tus productos</p>
        </div>
        <Button onClick={openCreate} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Agregar Producto
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Productos</p>
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
                <p className="text-sm font-medium text-muted-foreground">Valor Total</p>
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
                <p className="text-sm font-medium text-muted-foreground">Stock Bajo</p>
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
                <p className="text-sm font-medium text-muted-foreground">Sin Stock</p>
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
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, SKU o categoría..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={stockFilter} onValueChange={setStockFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Stock" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el stock</SelectItem>
                <SelectItem value="normal">Stock normal</SelectItem>
                <SelectItem value="low">Stock bajo</SelectItem>
                <SelectItem value="out">Sin stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Product Table */}
      {filteredInventory.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground">Producto</th>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">SKU</th>
                    <th className="text-center p-3 text-sm font-medium text-muted-foreground">Stock</th>
                    <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">Costo</th>
                    <th className="text-right p-3 text-sm font-medium text-muted-foreground">Precio</th>
                    <th className="text-right p-3 text-sm font-medium text-muted-foreground w-[100px]">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedInventory.map(item => {
                    const status = getStockStatus(item);
                    const StatusIcon = status.icon;
                    const itemMargin = getMargin(item.unitCost, item.sellingPrice);
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {item.isFavorite && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 shrink-0" />}
                            <div className="min-w-0">
                              <p className="font-medium truncate">{item.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{item.category}</Badge>
                                <span className="text-xs text-muted-foreground md:hidden">{item.sku}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 hidden md:table-cell">
                          <span className="text-sm text-muted-foreground font-mono">{item.sku}</span>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-sm">{item.currentStock}</span>
                            <Badge className={`${status.className} text-[10px] px-1.5 py-0`}>
                              <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                              {status.label}
                            </Badge>
                          </div>
                        </td>
                        <td className="p-3 text-right hidden md:table-cell">
                          <span className="text-sm text-muted-foreground">₡{item.unitCost.toLocaleString()}</span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-medium">₡{item.sellingPrice.toLocaleString()}</span>
                            {itemMargin !== null && (
                              <span className={`text-[10px] ${itemMargin > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {itemMargin > 0 ? '+' : ''}{itemMargin}%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(item)} className="h-8 w-8 p-0">
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteTarget(item)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Pagination controls: only shown when there is more than one page */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  Mostrando {firstItemIndex}-{lastItemIndex} de {filteredInventory.length} productos
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                  >
                    Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground min-w-[80px] text-center">
                    Página {currentPage} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium mb-1">
              {inventory.length === 0 ? 'Sin productos aún' : 'Sin resultados'}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {inventory.length === 0
                ? 'Agrega tu primer producto para empezar a gestionar tu inventario.'
                : 'Intenta cambiar los filtros o el término de búsqueda.'}
            </p>
            {inventory.length === 0 && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Agregar Primer Producto
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ======= CREATE / EDIT DIALOG ======= */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) { setShowForm(false); setEditingItem(null); setIsCreatingCategory(false); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Editar Producto' : 'Nuevo Producto'}</DialogTitle>
            <DialogDescription>
              {editingItem ? 'Modifica los datos del producto.' : 'Completa los campos esenciales. Los avanzados son opcionales.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Essential fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Name */}
              <div className="sm:col-span-2">
                <Label htmlFor="dlg-name">Nombre del Producto *</Label>
                <Input
                  id="dlg-name"
                  value={formData.name}
                  onChange={e => updateField('name', e.target.value)}
                  placeholder="ej. Camiseta Roja Talla M"
                  required
                  autoFocus
                />
              </div>

              {/* SKU */}
              <div>
                <Label htmlFor="dlg-sku">SKU / Código *</Label>
                <div className="flex gap-2">
                  <Input
                    id="dlg-sku"
                    value={formData.sku}
                    onChange={e => updateField('sku', e.target.value)}
                    placeholder="ej. CAM-ROJ-M"
                    required
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-10 md:h-10 px-2.5"
                    title="Generar SKU automático"
                    onClick={() => updateField('sku', generateSKU(formData.name, formData.category))}
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Category */}
              <div>
                <Label>Categoría *</Label>
                {categories.length > 0 && !isCreatingCategory ? (
                  <Select
                    value={formData.category || undefined}
                    onValueChange={v => {
                      if (v === '__new__') {
                        setIsCreatingCategory(true);
                        updateField('category', '');
                      } else {
                        updateField('category', v);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Nueva categoría...</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={formData.category}
                      onChange={e => updateField('category', e.target.value)}
                      placeholder="Nombre de la nueva categoría"
                      required
                      autoFocus
                    />
                    {categories.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 self-center"
                        onClick={() => {
                          setIsCreatingCategory(false);
                          updateField('category', '');
                        }}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Prices with margin */}
              <div>
                <Label htmlFor="dlg-cost">Costo Unitario *</Label>
                <Input
                  id="dlg-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.unitCost}
                  onChange={e => updateField('unitCost', e.target.value)}
                  onBlur={e => { if (e.target.value === '') updateField('unitCost', 0); }}
                  placeholder="₡0.00"
                  required
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="dlg-price">Precio de Venta *</Label>
                  {margin !== null && (
                    <Badge variant="outline" className={`text-[10px] ${margin > 0 ? 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-400' : 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-400'}`}>
                      Margen: {margin > 0 ? '+' : ''}{margin}%
                    </Badge>
                  )}
                </div>
                <Input
                  id="dlg-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.sellingPrice}
                  onChange={e => updateField('sellingPrice', e.target.value)}
                  onBlur={e => { if (e.target.value === '') updateField('sellingPrice', 0); }}
                  placeholder="₡0.00"
                  required
                />
              </div>

              {/* Stock */}
              <div>
                <Label htmlFor="dlg-stock">Stock Actual *</Label>
                <Input
                  id="dlg-stock"
                  type="number"
                  min="0"
                  value={formData.currentStock}
                  onChange={e => updateField('currentStock', e.target.value)}
                  onBlur={e => { if (e.target.value === '') updateField('currentStock', 0); }}
                  placeholder="0"
                  required
                />
              </div>

              {/* Favorite */}
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <button
                    type="button"
                    onClick={() => updateField('isFavorite', !formData.isFavorite)}
                    className={`h-8 w-8 rounded-md border flex items-center justify-center transition-colors ${formData.isFavorite ? 'bg-yellow-50 border-yellow-300 dark:bg-yellow-900/30 dark:border-yellow-700' : 'border-input hover:bg-muted'}`}
                  >
                    <Star className={`h-4 w-4 ${formData.isFavorite ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground'}`} />
                  </button>
                  <span className="text-sm">Producto Favorito</span>
                </label>
              </div>

              {/* Description */}
              <div className="sm:col-span-2">
                <Label htmlFor="dlg-desc">Descripción</Label>
                <Textarea
                  id="dlg-desc"
                  value={formData.description}
                  onChange={e => updateField('description', e.target.value)}
                  placeholder="Descripción breve del producto (opcional)"
                  className="min-h-[60px] resize-none"
                  rows={2}
                />
              </div>
            </div>

            {/* Advanced fields */}
            <div className="border rounded-lg">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full p-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Configuración avanzada</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>

              {showAdvanced && (
                <div className="px-3 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
                  <div>
                    <Label htmlFor="dlg-minstock">Stock Mínimo</Label>
                    <Input
                      id="dlg-minstock"
                      type="number"
                      min="0"
                      value={formData.minStock}
                      onChange={e => updateField('minStock', e.target.value)}
                      onBlur={e => { if (e.target.value === '') updateField('minStock', 0); }}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dlg-maxstock">Stock Máximo</Label>
                    <Input
                      id="dlg-maxstock"
                      type="number"
                      min="0"
                      value={formData.maxStock}
                      onChange={e => updateField('maxStock', e.target.value)}
                      onBlur={e => { if (e.target.value === '') updateField('maxStock', 0); }}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dlg-reorder">Punto de Reorden</Label>
                    <Input
                      id="dlg-reorder"
                      type="number"
                      min="0"
                      value={formData.reorderPoint}
                      onChange={e => updateField('reorderPoint', e.target.value)}
                      onBlur={e => { if (e.target.value === '') updateField('reorderPoint', 0); }}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dlg-reorderqty">Cantidad de Reorden</Label>
                    <Input
                      id="dlg-reorderqty"
                      type="number"
                      min="0"
                      value={formData.reorderQuantity}
                      onChange={e => updateField('reorderQuantity', e.target.value)}
                      onBlur={e => { if (e.target.value === '') updateField('reorderQuantity', 0); }}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dlg-supplier">Proveedor</Label>
                    <Input
                      id="dlg-supplier"
                      value={formData.supplier}
                      onChange={e => updateField('supplier', e.target.value)}
                      placeholder="Nombre del proveedor"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dlg-location">Ubicación</Label>
                    <Input
                      id="dlg-location"
                      value={formData.location}
                      onChange={e => updateField('location', e.target.value)}
                      placeholder="ej. Bodega A, Estante 3"
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); }}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingItem ? 'Actualizar' : 'Crear Producto'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ======= DELETE CONFIRMATION DIALOG ======= */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar producto</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar <strong>{deleteTarget?.name}</strong>? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
