'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, Building2, Info } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';

interface BusinessField {
  id?: string;
  name: string;
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
  order: number;
}

export function BusinessInfoStep({ onNext, markCompleted, markUnsavedChanges }: WizardStepProps) {
  const [fields, setFields] = useState<BusinessField[]>([]);
  const [initialFields, setInitialFields] = useState<BusinessField[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExistingFields();
  }, []);

  // Track changes
  useEffect(() => {
    const hasChanges = JSON.stringify(fields) !== JSON.stringify(initialFields);
    markUnsavedChanges(hasChanges);
  }, [fields, initialFields, markUnsavedChanges]);

  const loadExistingFields = async () => {
    try {
      const response = await fetch('/api/config/business-info');
      if (response.ok) {
        const result = await response.json();
        if (result.status === 'success' && result.data?.length > 0) {
          // Map API response to wizard format
          const loadedFields = result.data.map((field: any) => ({
            id: field.id,
            name: field.name,
            type: field.type,
            label: field.label,
            placeholder: field.placeholder || '',
            required: field.required || false,
            order: field.order || 0
          }));
          setFields(loadedFields);
          setInitialFields(loadedFields);
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading business info:', error);
    }
  };

  const addField = () => {
    setFields([...fields, {
      name: '',
      type: 'text',
      label: '',
      placeholder: '',
      required: false,
      order: fields.length
    }]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, key: keyof BusinessField, value: any) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], [key]: value };
    setFields(updated);
  };

  const handleSave = async () => {
    // Validate
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
      // Save each field
      for (const field of fields) {
        const response = await fetch('/api/config/business-info', {
          method: field.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(field)
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `Failed to ${field.id ? 'update' : 'create'} field: ${response.statusText}`);
        }
        
        const result = await response.json();
        if (result.status !== 'success') {
          throw new Error(result.error || 'Failed to save field');
        }
      }

      markCompleted();
      setInitialFields(fields); // Update initial state to current state
      markUnsavedChanges(false); // Clear unsaved changes flag
      toast({
        title: '¡Guardado!',
        description: `${fields.length} campos de información empresarial configurados.`
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
    { name: 'companyName', label: 'Nombre de la Empresa', type: 'text' },
    { name: 'ruc', label: 'RUC/NIT', type: 'text' },
    { name: 'phone', label: 'Teléfono', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'address', label: 'Dirección', type: 'text' },
    { name: 'website', label: 'Sitio Web', type: 'url' }
  ];

  const addSuggested = (suggested: any) => {
    setFields([...fields, {
      name: suggested.name,
      type: suggested.type,
      label: suggested.label,
      placeholder: `Ingrese ${suggested.label.toLowerCase()}`,
      required: false,
      order: fields.length
    }]);
  };

  return (
    <div className="space-y-6">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-5 w-5 text-blue-600" />
          Información del Negocio
        </h3>
        <p className="text-gray-600">
          Define campos personalizados para capturar información específica de tu empresa en cada pedido.
          Estos campos aparecerán en el formulario de creación de pedidos.
        </p>
      </div>

      {/* Suggested Fields */}
      {fields.length === 0 && (
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-blue-900 mb-2">Campos Sugeridos:</h4>
              <div className="flex flex-wrap gap-2">
                {suggestedFields.map((field, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => addSuggested(field)}
                    className="text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {field.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Fields List */}
      <div className="space-y-4">
        {fields.map((field, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nombre del Campo</Label>
                <Input
                  value={field.name}
                  onChange={(e) => updateField(index, 'name', e.target.value)}
                  placeholder="ej: companyName"
                />
              </div>
              <div>
                <Label>Etiqueta</Label>
                <Input
                  value={field.label}
                  onChange={(e) => updateField(index, 'label', e.target.value)}
                  placeholder="ej: Nombre de la Empresa"
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
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="tel">Teléfono</SelectItem>
                    <SelectItem value="url">URL</SelectItem>
                    <SelectItem value="number">Número</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Placeholder</Label>
                <Input
                  value={field.placeholder}
                  onChange={(e) => updateField(index, 'placeholder', e.target.value)}
                  placeholder="Texto de ayuda"
                />
              </div>
              <div className="flex items-center justify-between col-span-2">
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

      {/* Add Field Button */}
      <Button variant="outline" onClick={addField} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Campo
      </Button>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4">
        <Button
          onClick={handleSave}
          disabled={loading || fields.length === 0}
        >
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

