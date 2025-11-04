'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, Package } from 'lucide-react';

interface InventoryItem {
  id?: string;
  productName: string;
  sku?: string;
  quantity: number;
  price: number;
}

export function InventoryStep({ onNext, onSkip, markCompleted }: WizardStepProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExisting();
  }, []);

  const loadExisting = async () => {
    try {
      const response = await fetch('/api/config/inventory');
      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success' && result.data?.length > 0) {
          // Map API response to wizard format
          setItems(result.data.map((item: any) => ({
            id: item.id,
            productName: item.name,
            sku: item.sku || '',
            quantity: item.currentStock || 0,
            price: item.sellingPrice || item.unitCost || 0
          })));
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading inventory:', error);
    }
  };

  const addItem = () => {
    setItems([...items, { productName: '', sku: '', quantity: 0, price: 0 }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, key: keyof InventoryItem, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [key]: value };
    setItems(updated);
  };

  const handleSave = async () => {
    const invalid = items.filter(i => !i.productName);
    if (invalid.length > 0) {
      toast({ title: 'Campos incompletos', description: 'Complete todos los productos.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      for (const item of items) {
        const response = await fetch('/api/config/inventory', {
          method: item.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            productName: item.productName,
            sku: item.sku || `SKU-${Date.now()}`,
            quantity: item.quantity,
            price: item.price
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `Failed to ${item.id ? 'update' : 'create'} inventory item: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.error || 'Failed to save inventory item');
        }
      }

      markCompleted();
      toast({ title: '¡Guardado!', description: `${items.length} productos guardados.` });
      setTimeout(onNext, 800);
    } catch (error) {
      toast({ title: 'Error', description: 'No se pudo guardar.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Package className="h-5 w-5 text-blue-600" />
          Inventario
        </h3>
        <p className="text-gray-600">
          Agrega los productos que manejas. Puedes omitir este paso y agregarlo más tarde.
        </p>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <Label>Producto</Label>
                <Input
                  value={item.productName}
                  onChange={(e) => updateItem(index, 'productName', e.target.value)}
                  placeholder="Nombre del producto"
                />
              </div>
              <div>
                <Label>SKU</Label>
                <Input
                  value={item.sku || ''}
                  onChange={(e) => updateItem(index, 'sku', e.target.value)}
                  placeholder="Código"
                />
              </div>
              <div>
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Precio</Label>
                <Input
                  type="number"
                  value={item.price}
                  onChange={(e) => updateItem(index, 'price', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="md:col-span-4 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => removeItem(index)} className="text-red-600">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addItem} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Producto
      </Button>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onSkip}>Omitir por ahora</Button>
        <Button onClick={handleSave} disabled={loading || items.length === 0}>
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

