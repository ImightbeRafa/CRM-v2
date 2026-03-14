'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import {
  Package,
  Plus,
  Trash2,
  Loader2,
  Save,
  CheckCircle2,
} from 'lucide-react';
import type { WizardStepProps } from '../SetupWizard';

interface Product {
  id?: string;
  productName: string;
  sku: string;
  quantity: number;
  price: number;
}

const EMPTY_PRODUCT: Product = { productName: '', sku: '', quantity: 0, price: 0 };

export function FirstProductStep({ markCompleted, markUnsavedChanges }: WizardStepProps) {
  const [products, setProducts] = useState<Product[]>([{ ...EMPTY_PRODUCT }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => { loadProducts(); }, []);

  useEffect(() => {
    const hasContent = products.some(p => p.productName.trim());
    markUnsavedChanges(hasContent && !products.every(p => p.id));
  }, [products, markUnsavedChanges]);

  const loadProducts = async () => {
    try {
      const res = await fetch('/api/config/inventory', { credentials: 'include' });
      const data = await res.json();
      if (data.status === 'success' && data.data?.length > 0) {
        setProducts(data.data.map((p: any) => ({
          id: p.id,
          productName: p.name || p.productName || '',
          sku: p.sku || '',
          quantity: p.currentStock ?? p.quantity ?? 0,
          price: p.sellingPrice ?? p.unitCost ?? p.price ?? 0,
        })));
        markCompleted();
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const addProduct = () => {
    setProducts(prev => [...prev, { ...EMPTY_PRODUCT }]);
  };

  const removeProduct = (idx: number) => {
    setProducts(prev => prev.filter((_, i) => i !== idx));
  };

  const updateProduct = (idx: number, key: keyof Product, value: any) => {
    setProducts(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  };

  const handleSave = async () => {
    const valid = products.filter(p => p.productName.trim());
    if (valid.length === 0) {
      toast({ title: 'Agrega al menos un producto', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      for (const p of valid) {
        const res = await fetch('/api/config/inventory', {
          method: p.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            id: p.id,
            productName: p.productName.trim(),
            sku: p.sku || `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            quantity: p.quantity,
            price: p.price,
          }),
        });
        if (!res.ok) throw new Error();
      }
      markCompleted();
      toast({ title: '¡Guardado!', description: `${valid.length} producto(s) agregado(s).` });
    } catch {
      toast({ title: 'Error', description: 'No se pudo guardar.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-gray-600">
        Agrega al menos un producto para empezar. Podés importar más después desde Configuración &gt; Inventario.
      </p>

      <div className="space-y-4">
        {products.map((p, idx) => (
          <Card key={idx} className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label>Nombre del Producto <span className="text-red-500">*</span></Label>
                <Input
                  value={p.productName}
                  onChange={e => updateProduct(idx, 'productName', e.target.value)}
                  placeholder="Ej: Camiseta Negra M"
                />
              </div>
              <div>
                <Label>SKU</Label>
                <Input
                  value={p.sku}
                  onChange={e => updateProduct(idx, 'sku', e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label>Precio (₡)</Label>
                <Input
                  type="number"
                  min={0}
                  value={p.price || ''}
                  onChange={e => updateProduct(idx, 'price', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Cantidad en Stock</Label>
                <Input
                  type="number"
                  min={0}
                  value={p.quantity || ''}
                  onChange={e => updateProduct(idx, 'quantity', parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              {products.length > 1 && (
                <div className="flex items-end">
                  <Button variant="ghost" size="sm" onClick={() => removeProduct(idx)} className="text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addProduct} className="w-full">
        <Plus className="h-4 w-4 mr-2" /> Agregar Otro Producto
      </Button>

      <Button
        onClick={handleSave}
        disabled={saving || !products.some(p => p.productName.trim())}
        className="w-full h-11"
      >
        {saving ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>
        ) : (
          <><Save className="h-4 w-4 mr-2" />Guardar Productos</>
        )}
      </Button>
    </div>
  );
}
