'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, Truck } from 'lucide-react';

interface ShippingMethod {
  id?: string;
  name: string;
  cost: number;
  estimatedDays?: number;
}

export function ShippingStep({ onNext, onSkip, markCompleted }: WizardStepProps) {
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExisting();
  }, []);

  const loadExisting = async () => {
    try {
      const response = await fetch('/api/config/shipping');
      if (response.ok) {
        const result = await response.json();
        if (result.data?.length > 0) {
          setMethods(result.data);
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading shipping methods:', error);
    }
  };

  const addMethod = () => {
    setMethods([...methods, { name: '', cost: 0, estimatedDays: 1 }]);
  };

  const removeMethod = (index: number) => {
    setMethods(methods.filter((_, i) => i !== index));
  };

  const updateMethod = (index: number, key: keyof ShippingMethod, value: any) => {
    const updated = [...methods];
    updated[index] = { ...updated[index], [key]: value };
    setMethods(updated);
  };

  const handleSave = async () => {
    const invalid = methods.filter(m => !m.name);
    if (invalid.length > 0) {
      toast({ title: 'Campos incompletos', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      for (const method of methods) {
        const reqMethod = method.id ? 'PUT' : 'POST';
        await fetch('/api/config/shipping', {
          method: reqMethod,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(method)
        });
      }

      markCompleted();
      toast({ title: '¡Guardado!', description: `${methods.length} métodos de envío guardados.` });
      setTimeout(onNext, 800);
    } catch (error) {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const defaultMethods = [
    { name: 'Mensajero Propio', cost: 0, estimatedDays: 1 },
    { name: 'Correos de Costa Rica', cost: 2500, estimatedDays: 3 },
    { name: 'Express', cost: 5000, estimatedDays: 1 },
  ];

  const loadDefaults = () => {
    setMethods(defaultMethods);
  };

  return (
    <div className="space-y-6">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Truck className="h-5 w-5 text-blue-600" />
          Métodos de Envío
        </h3>
        <p className="text-gray-600">
          Configure los métodos de envío que ofreces a tus clientes.
        </p>
      </div>

      {methods.length === 0 && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <h4 className="font-medium text-blue-900 mb-2">Métodos Sugeridos:</h4>
          <Button variant="outline" size="sm" onClick={loadDefaults}>
            Cargar Métodos por Defecto
          </Button>
        </Card>
      )}

      <div className="space-y-4">
        {methods.map((method, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Nombre del Método</Label>
                <Input
                  value={method.name}
                  onChange={(e) => updateMethod(index, 'name', e.target.value)}
                  placeholder="ej: Mensajero Propio"
                />
              </div>
              <div>
                <Label>Costo</Label>
                <Input
                  type="number"
                  value={method.cost}
                  onChange={(e) => updateMethod(index, 'cost', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Días Estimados</Label>
                <Input
                  type="number"
                  value={method.estimatedDays || ''}
                  onChange={(e) => updateMethod(index, 'estimatedDays', parseInt(e.target.value) || 1)}
                  placeholder="1"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => removeMethod(index)} className="text-red-600">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addMethod} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Método de Envío
      </Button>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onSkip}>Omitir</Button>
        <Button onClick={handleSave} disabled={loading || methods.length === 0}>
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

