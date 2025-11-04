'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, Users } from 'lucide-react';

interface Seller {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
}

export function SellersStep({ onNext, onSkip, markCompleted }: WizardStepProps) {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExisting();
  }, []);

  const loadExisting = async () => {
    try {
      const response = await fetch('/api/config/sellers');
      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success' && result.data?.length > 0) {
          // Map API response to wizard format (schema only has name, not email/phone)
          setSellers(result.data.map((s: any) => ({
            id: s.id,
            name: s.name,
            email: '', // Schema doesn't have email
            phone: '' // Schema doesn't have phone
          })));
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading sellers:', error);
    }
  };

  const addSeller = () => {
    setSellers([...sellers, { name: '', email: '', phone: '' }]);
  };

  const removeSeller = (index: number) => {
    setSellers(sellers.filter((_, i) => i !== index));
  };

  const updateSeller = (index: number, key: keyof Seller, value: any) => {
    const updated = [...sellers];
    updated[index] = { ...updated[index], [key]: value };
    setSellers(updated);
  };

  const handleSave = async () => {
    const invalid = sellers.filter(s => !s.name);
    if (invalid.length > 0) {
      toast({ title: 'Campos incompletos', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      for (const seller of sellers) {
        const response = await fetch('/api/config/sellers', {
          method: seller.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: seller.id,
            name: seller.name
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `Failed to ${seller.id ? 'update' : 'create'} seller: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.error || 'Failed to save seller');
        }
      }

      markCompleted();
      toast({ title: '¡Guardado!', description: `${sellers.length} vendedores guardados.` });
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
          <Users className="h-5 w-5 text-blue-600" />
          Vendedores
        </h3>
        <p className="text-gray-600">
          Registra a tu equipo de ventas para asignar pedidos y hacer seguimiento.
        </p>
      </div>

      <div className="space-y-4">
        {sellers.map((seller, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Nombre</Label>
                <Input
                  value={seller.name}
                  onChange={(e) => updateSeller(index, 'name', e.target.value)}
                  placeholder="Nombre del vendedor"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={seller.email || ''}
                  onChange={(e) => updateSeller(index, 'email', e.target.value)}
                  placeholder="vendedor@example.com"
                />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input
                  value={seller.phone || ''}
                  onChange={(e) => updateSeller(index, 'phone', e.target.value)}
                  placeholder="1234-5678"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => removeSeller(index)} className="text-red-600">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addSeller} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Vendedor
      </Button>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onSkip}>Omitir</Button>
        <Button onClick={handleSave} disabled={loading || sellers.length === 0}>
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

