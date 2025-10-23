'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, ShoppingCart } from 'lucide-react';

interface Product {
  id?: string;
  name: string;
  price: number;
  description?: string;
}

export function FrequentProductsStep({ onNext, onSkip, markCompleted }: WizardStepProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExisting();
  }, []);

  const loadExisting = async () => {
    try {
      const response = await fetch('/api/config/frequent-products');
      if (response.ok) {
        const result = await response.json();
        if (result.data?.length > 0) {
          setProducts(result.data);
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading products:', error);
    }
  };

  const addProduct = () => {
    setProducts([...products, { name: '', price: 0, description: '' }]);
  };

  const removeProduct = (index: number) => {
    setProducts(products.filter((_, i) => i !== index));
  };

  const updateProduct = (index: number, key: keyof Product, value: any) => {
    const updated = [...products];
    updated[index] = { ...updated[index], [key]: value };
    setProducts(updated);
  };

  const handleSave = async () => {
    const invalid = products.filter(p => !p.name);
    if (invalid.length > 0) {
      toast({ title: 'Campos incompletos', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      for (const product of products) {
        const method = product.id ? 'PUT' : 'POST';
        await fetch('/api/config/frequent-products', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product)
        });
      }

      markCompleted();
      toast({ title: '¡Guardado!', description: `${products.length} productos guardados.` });
      setTimeout(onNext, 800);
    } catch (error) {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-blue-600" />
          Productos Frecuentes
        </h3>
        <p className="text-gray-600">
          Cataloga tus productos más vendidos para crear pedidos más rápido.
        </p>
      </div>

      <div className="space-y-4">
        {products.map((product, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <Label>Nombre del Producto</Label>
                <Input
                  value={product.name}
                  onChange={(e) => updateProduct(index, 'name', e.target.value)}
                  placeholder="Nombre del producto"
                />
              </div>
              <div>
                <Label>Precio</Label>
                <Input
                  type="number"
                  value={product.price}
                  onChange={(e) => updateProduct(index, 'price', parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                />
              </div>
              <div className="md:col-span-3">
                <Label>Descripción (Opcional)</Label>
                <Input
                  value={product.description || ''}
                  onChange={(e) => updateProduct(index, 'description', e.target.value)}
                  placeholder="Descripción breve"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => removeProduct(index)} className="text-red-600">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addProduct} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Producto
      </Button>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onSkip}>Omitir</Button>
        <Button onClick={handleSave} disabled={loading || products.length === 0}>
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

