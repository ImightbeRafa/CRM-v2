'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, Settings, Palette, Ruler, Package } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';

interface CustomField {
  id?: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
}

export function CustomFieldsStep({ onNext, markCompleted }: WizardStepProps) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExistingFields();
  }, []);

  const loadExistingFields = async () => {
    try {
      const response = await fetch('/api/config/fields');
      if (response.ok) {
        const result = await response.json();
        if (result.data?.length > 0) {
          setFields(result.data);
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading custom fields:', error);
    }
  };

  const addField = () => {
    setFields([...fields, {
      name: '',
      label: '',
      type: 'text',
      required: false,
      order: fields.length
    }]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, key: keyof CustomField, value: any) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], [key]: value };
    setFields(updated);
  };

  const handleSave = async () => {
    const invalidFields = fields.filter(f => !f.name || !f.label);
    if (invalidFields.length > 0) {
      toast({
        title: 'Campos incompletos',
        description: 'Por favor completa todos los campos antes de continuar.',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      for (const field of fields) {
        if (field.id) {
          await fetch('/api/config/fields', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(field)
          });
        } else {
          await fetch('/api/config/fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(field)
          });
        }
      }

      markCompleted();
      toast({
        title: '¡Guardado!',
        description: `${fields.length} campos personalizados configurados.`
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

  const suggestedFields = [
    { name: 'color', label: 'Color', icon: Palette },
    { name: 'tamano', label: 'Tamaño', icon: Ruler },
    { name: 'material', label: 'Material', icon: Package },
    { name: 'empaque', label: 'Empaque', icon: Package }
  ];

  const addSuggested = (field: any) => {
    setFields([...fields, {
      name: field.name,
      label: field.label,
      type: 'text',
      required: false,
      order: fields.length
    }]);
  };

  return (
    <div className="space-y-6">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Settings className="h-5 w-5 text-blue-600" />
          Campos Personalizados de Productos
        </h3>
        <p className="text-gray-600">
          Agrega campos específicos para tus productos (color, tamaño, material, etc.).
          Estos campos aparecerán al crear o editar pedidos.
        </p>
      </div>

      {/* Suggested Fields */}
      {fields.length === 0 && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <h4 className="font-medium text-blue-900 mb-3">Campos Comunes:</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {suggestedFields.map((field, idx) => {
              const Icon = field.icon;
              return (
                <Button
                  key={idx}
                  variant="outline"
                  onClick={() => addSuggested(field)}
                  className="flex flex-col items-center gap-2 h-auto py-3"
                >
                  <Icon className="h-5 w-5 text-blue-600" />
                  <span className="text-xs">{field.label}</span>
                </Button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Fields List */}
      <div className="space-y-4">
        {fields.map((field, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Nombre del Campo</Label>
                <Input
                  value={field.name}
                  onChange={(e) => updateField(index, 'name', e.target.value)}
                  placeholder="ej: color"
                />
              </div>
              <div>
                <Label>Etiqueta</Label>
                <Input
                  value={field.label}
                  onChange={(e) => updateField(index, 'label', e.target.value)}
                  placeholder="ej: Color"
                />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select
                  value={field.type}
                  onValueChange={(value) => updateField(index, 'type', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Texto</SelectItem>
                    <SelectItem value="number">Número</SelectItem>
                    <SelectItem value="select">Selección</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between col-span-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(index, 'required', e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">Campo requerido</span>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeField(index)}
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

      <Button variant="outline" onClick={addField} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Campo Personalizado
      </Button>

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={handleSave} disabled={loading || fields.length === 0}>
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

