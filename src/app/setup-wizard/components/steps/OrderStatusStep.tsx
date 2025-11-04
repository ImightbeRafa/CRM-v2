'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, Tags, AlertCircle } from 'lucide-react';

interface OrderStatus {
  id?: string;
  name: string;
  color: string;
  order: number;
  isActive: boolean;
}

export function OrderStatusStep({ onNext, markCompleted }: WizardStepProps) {
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExistingStatuses();
  }, []);

  const loadExistingStatuses = async () => {
    try {
      const response = await fetch('/api/config/status');
      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success' && result.data?.length > 0) {
          // Map API response to wizard format
          setStatuses(result.data.map((s: any) => ({
            id: s.id,
            name: s.label || s.name || '',
            color: s.color || '#3B82F6',
            order: s.order || 0,
            isActive: s.isActive !== undefined ? s.isActive : true
          })));
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading order statuses:', error);
    }
  };

  const addStatus = () => {
    setStatuses([...statuses, {
      name: '',
      color: '#3B82F6',
      order: statuses.length,
      isActive: true
    }]);
  };

  const removeStatus = (index: number) => {
    setStatuses(statuses.filter((_, i) => i !== index));
  };

  const updateStatus = (index: number, key: keyof OrderStatus, value: any) => {
    const updated = [...statuses];
    updated[index] = { ...updated[index], [key]: value };
    setStatuses(updated);
  };

  const handleSave = async () => {
    const invalidStatuses = statuses.filter(s => !s.name);
    if (invalidStatuses.length > 0) {
      toast({
        title: 'Estados incompletos',
        description: 'Por favor completa todos los estados antes de continuar.',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      for (const status of statuses) {
        const response = await fetch('/api/config/status', {
          method: status.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: status.id,
            name: status.name,
            color: status.color,
            order: status.order,
            isActive: status.isActive
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `Failed to ${status.id ? 'update' : 'create'} status: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.error || 'Failed to save status');
        }
      }

      markCompleted();
      toast({
        title: '¡Guardado!',
        description: `${statuses.length} estados de pedidos configurados.`
      });
      
      setTimeout(onNext, 800);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'No se pudo guardar la configuración.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const defaultStatuses = [
    { name: 'Pendiente', color: '#F59E0B' },
    { name: 'En Producción', color: '#3B82F6' },
    { name: 'Listo', color: '#8B5CF6' },
    { name: 'Enviado', color: '#06B6D4' },
    { name: 'Entregado', color: '#10B981' },
    { name: 'Cancelado', color: '#EF4444' }
  ];

  const loadDefaults = () => {
    setStatuses(defaultStatuses.map((s, idx) => ({
      name: s.name,
      color: s.color,
      order: idx,
      isActive: true
    })));
  };

  return (
    <div className="space-y-6">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Tags className="h-5 w-5 text-blue-600" />
          Estados de Pedidos
        </h3>
        <p className="text-gray-600">
          Define los estados por los que pasan tus pedidos. Estos aparecerán en el tablero Kanban de producción.
        </p>
      </div>

      {statuses.length === 0 && (
        <Card className="p-4 bg-yellow-50 border-yellow-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-yellow-900 mb-2">Estados Requeridos</h4>
              <p className="text-sm text-yellow-800 mb-3">
                Los estados son esenciales para el flujo de trabajo. Puedes usar los estados por defecto o crear los tuyos.
              </p>
              <Button variant="outline" size="sm" onClick={loadDefaults}>
                Cargar Estados por Defecto
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {statuses.map((status, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <Label>Nombre del Estado</Label>
                <Input
                  value={status.name}
                  onChange={(e) => updateStatus(index, 'name', e.target.value)}
                  placeholder="ej: En Producción"
                />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={status.color}
                    onChange={(e) => updateStatus(index, 'color', e.target.value)}
                    className="w-12 h-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={status.color}
                    onChange={(e) => updateStatus(index, 'color', e.target.value)}
                    placeholder="#3B82F6"
                  />
                </div>
              </div>
              <div className="md:col-span-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span
                    className="px-3 py-1 rounded-full text-white text-sm font-medium"
                    style={{ backgroundColor: status.color }}
                  >
                    {status.name || 'Vista Previa'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeStatus(index)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addStatus} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Estado
      </Button>

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={handleSave} disabled={loading || statuses.length === 0}>
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

