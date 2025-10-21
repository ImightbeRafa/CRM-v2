'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Checkbox } from '@/app/components/ui/checkbox';
import { 
  Palette, 
  Ruler, 
  Package, 
  Tag, 
  Star, 
  Zap, 
  Settings, 
  CheckCircle, 
  XCircle,
  Info,
  Plus,
  Edit
} from 'lucide-react';
import { QuickSetupWizard } from './QuickSetupWizard';

interface PresetField {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'boolean';
  description: string;
  icon: React.ComponentType<any>;
  category: 'basic' | 'appearance' | 'details' | 'pricing';
  isEnabled: boolean;
  isRequired: boolean;
  order: number;
  options?: Array<{
    label: string;
    value: string;
    priceDelta?: number;
  }>;
}

const PRESET_FIELDS: PresetField[] = [
  // Basic Fields
  {
    id: 'color',
    key: 'color',
    label: 'Color',
    type: 'select',
    description: 'Color del producto',
    icon: Palette,
    category: 'basic',
    isEnabled: false,
    isRequired: false,
    order: 1,
    options: [
      { label: 'Rojo', value: 'rojo' },
      { label: 'Azul', value: 'azul' },
      { label: 'Verde', value: 'verde' },
      { label: 'Negro', value: 'negro' },
      { label: 'Blanco', value: 'blanco' },
      { label: 'Amarillo', value: 'amarillo' },
      { label: 'Rosa', value: 'rosa' },
      { label: 'Morado', value: 'morado' }
    ]
  },
  {
    id: 'tamano',
    key: 'tamano',
    label: 'Tamaño',
    type: 'select',
    description: 'Tamaño del producto',
    icon: Ruler,
    category: 'basic',
    isEnabled: false,
    isRequired: false,
    order: 2,
    options: [
      { label: 'XS', value: 'xs' },
      { label: 'S', value: 's' },
      { label: 'M', value: 'm' },
      { label: 'L', value: 'l' },
      { label: 'XL', value: 'xl' },
      { label: 'XXL', value: 'xxl' },
      { label: 'Único', value: 'unico' }
    ]
  },
  {
    id: 'material',
    key: 'material',
    label: 'Material',
    type: 'select',
    description: 'Material del producto',
    icon: Package,
    category: 'basic',
    isEnabled: false,
    isRequired: false,
    order: 3,
    options: [
      { label: 'Algodón', value: 'algodon' },
      { label: 'Poliester', value: 'poliester' },
      { label: 'Cuero', value: 'cuero' },
      { label: 'Plástico', value: 'plastico' },
      { label: 'Metal', value: 'metal' },
      { label: 'Madera', value: 'madera' }
    ]
  },
  // Appearance Fields
  {
    id: 'estilo',
    key: 'estilo',
    label: 'Estilo',
    type: 'select',
    description: 'Estilo del producto',
    icon: Star,
    category: 'appearance',
    isEnabled: false,
    isRequired: false,
    order: 4,
    options: [
      { label: 'Clásico', value: 'clasico' },
      { label: 'Moderno', value: 'moderno' },
      { label: 'Vintage', value: 'vintage' },
      { label: 'Deportivo', value: 'deportivo' },
      { label: 'Elegante', value: 'elegante' },
      { label: 'Casual', value: 'casual' }
    ]
  },
  {
    id: 'marca',
    key: 'marca',
    label: 'Marca',
    type: 'text',
    description: 'Marca del producto',
    icon: Tag,
    category: 'appearance',
    isEnabled: false,
    isRequired: false,
    order: 5
  },
  // Details Fields
  {
    id: 'peso',
    key: 'peso',
    label: 'Peso',
    type: 'number',
    description: 'Peso del producto en gramos',
    icon: Package,
    category: 'details',
    isEnabled: false,
    isRequired: false,
    order: 6
  },
  {
    id: 'dimensiones',
    key: 'dimensiones',
    label: 'Dimensiones',
    type: 'text',
    description: 'Dimensiones del producto (ej: 20x30x10 cm)',
    icon: Ruler,
    category: 'details',
    isEnabled: false,
    isRequired: false,
    order: 7
  },
  {
    id: 'garantia',
    key: 'garantia',
    label: 'Garantía',
    type: 'select',
    description: 'Período de garantía',
    icon: CheckCircle,
    category: 'details',
    isEnabled: false,
    isRequired: false,
    order: 8,
    options: [
      { label: 'Sin garantía', value: 'sin_garantia' },
      { label: '30 días', value: '30_dias' },
      { label: '90 días', value: '90_dias' },
      { label: '1 año', value: '1_ano' },
      { label: '2 años', value: '2_anos' },
      { label: 'Lifetime', value: 'lifetime' }
    ]
  },
  // Pricing Fields
  {
    id: 'descuento',
    key: 'descuento',
    label: 'Descuento',
    type: 'number',
    description: 'Porcentaje de descuento aplicable',
    icon: Tag,
    category: 'pricing',
    isEnabled: false,
    isRequired: false,
    order: 9
  },
  {
    id: 'precio_especial',
    key: 'precio_especial',
    label: 'Precio Especial',
    type: 'number',
    description: 'Precio especial para este producto',
    icon: Zap,
    category: 'pricing',
    isEnabled: false,
    isRequired: false,
    order: 10
  }
];

export function PresetFieldsManager() {
  const [presetFields, setPresetFields] = useState<PresetField[]>(PRESET_FIELDS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [showQuickSetup, setShowQuickSetup] = useState(false);
  const [hasAnyFields, setHasAnyFields] = useState(false);

  useEffect(() => {
    loadCurrentFields();
  }, []);

  const loadCurrentFields = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/config/fields');
      const data = await response.json();
      
      if (data.status === 'success') {
        const currentFields = data.data;
        
        // Update preset fields with current status
        setPresetFields(prev => prev.map(preset => {
          const currentField = currentFields.find((f: any) => f.key === preset.key);
          return {
            ...preset,
            isEnabled: !!currentField,
            isRequired: currentField?.required || false,
            order: currentField?.order || preset.order
          };
        }));
        
        // Check if there are any fields configured
        setHasAnyFields(currentFields.length > 0);
      }
    } catch (error) {
      console.error('Error loading current fields:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleField = async (fieldId: string, enabled: boolean) => {
    const field = presetFields.find(f => f.id === fieldId);
    if (!field) return;

    setSaving(true);
    try {
      if (enabled) {
        // Create the field
        const response = await fetch('/api/config/fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.isRequired,
            order: field.order,
            optionSetId: null // We'll create option sets separately
          })
        });

        if (response.ok) {
          // If it's a select field, create the option set
          if (field.type === 'select' && field.options) {
            await createOptionSet(field);
          }
          
          setPresetFields(prev => prev.map(f => 
            f.id === fieldId ? { ...f, isEnabled: true } : f
          ));
        }
      } else {
        // Delete the field
        const response = await fetch('/api/config/fields', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: fieldId })
        });

        if (response.ok) {
          setPresetFields(prev => prev.map(f => 
            f.id === fieldId ? { ...f, isEnabled: false } : f
          ));
        }
      }
    } catch (error) {
      console.error('Error toggling field:', error);
    } finally {
      setSaving(false);
    }
  };

  const createOptionSet = async (field: PresetField) => {
    try {
      // First create the option set
      const optionSetResponse = await fetch('/api/config/option-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: field.label,
          key: field.key,
          description: field.description
        })
      });

      if (optionSetResponse.ok) {
        const optionSetData = await optionSetResponse.json();
        
        // Then create the options
        for (const option of field.options || []) {
          await fetch('/api/config/options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              optionSetId: optionSetData.data.id,
              label: option.label,
              value: option.value,
              priceDelta: option.priceDelta || 0
            })
          });
        }
      }
    } catch (error) {
      console.error('Error creating option set:', error);
    }
  };

  const toggleRequired = (fieldId: string, required: boolean) => {
    setPresetFields(prev => prev.map(f => 
      f.id === fieldId ? { ...f, isRequired: required } : f
    ));
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'basic': return Package;
      case 'appearance': return Star;
      case 'details': return Settings;
      case 'pricing': return Tag;
      default: return Settings;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'basic': return 'bg-blue-100 text-blue-800';
      case 'appearance': return 'bg-purple-100 text-purple-800';
      case 'details': return 'bg-green-100 text-green-800';
      case 'pricing': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const categories = [
    { key: 'basic', label: 'Campos Básicos', description: 'Información esencial del producto' },
    { key: 'appearance', label: 'Apariencia', description: 'Características visuales' },
    { key: 'details', label: 'Detalles Técnicos', description: 'Especificaciones técnicas' },
    { key: 'pricing', label: 'Precios', description: 'Información de precios' }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Cargando campos...</span>
      </div>
    );
  }

  // Show quick setup wizard if no fields are configured
  if (!hasAnyFields && !showQuickSetup) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="p-4 bg-blue-100 rounded-full w-16 h-16 mx-auto mb-4">
            <Zap className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Bienvenido a Betsy CRM!</h2>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Para empezar, necesitamos configurar algunos campos básicos para tus productos. 
            Te ayudamos con una configuración rápida.
          </p>
          <Button
            onClick={() => setShowQuickSetup(true)}
            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
          >
            <Zap className="w-4 h-4 mr-2" />
            Configuración Rápida
          </Button>
        </div>
      </div>
    );
  }

  if (showQuickSetup) {
    return (
      <QuickSetupWizard 
        onComplete={() => {
          setShowQuickSetup(false);
          loadCurrentFields();
        }} 
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 rounded-xl text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white bg-opacity-20 rounded-xl">
              <Zap className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Campos Predefinidos</h2>
              <p className="text-indigo-100">Activa los campos que necesitas con un solo clic</p>
            </div>
          </div>
          <Button
            onClick={() => setShowCustomForm(true)}
            className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white border-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Campo Personalizado
          </Button>
        </div>
      </div>

      {/* Categories */}
      {categories.map(category => {
        const categoryFields = presetFields.filter(f => f.category === category.key);
        const CategoryIcon = getCategoryIcon(category.key);
        
        return (
          <Card key={category.key} className="overflow-hidden">
            <CardHeader className="bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg">
                  <CategoryIcon className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <CardTitle className="text-lg">{category.label}</CardTitle>
                  <p className="text-sm text-gray-600">{category.description}</p>
                </div>
                <Badge className={getCategoryColor(category.key)}>
                  {categoryFields.filter(f => f.isEnabled).length} / {categoryFields.length} activos
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {categoryFields.map(field => {
                  const Icon = field.icon;
                  return (
                    <div
                      key={field.id}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        field.isEnabled 
                          ? 'border-green-200 bg-green-50' 
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${
                            field.isEnabled ? 'bg-green-100' : 'bg-gray-100'
                          }`}>
                            <Icon className={`w-5 h-5 ${
                              field.isEnabled ? 'text-green-600' : 'text-gray-600'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium text-gray-900">{field.label}</h3>
                              {field.isEnabled && (
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">{field.description}</p>
                            {field.options && (
                              <div className="mt-2">
                                <p className="text-xs text-gray-500">
                                  {field.options.length} opciones predefinidas
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Checkbox
                            checked={field.isEnabled}
                            onCheckedChange={(checked) => toggleField(field.id, !!checked)}
                            disabled={saving}
                          />
                          {field.isEnabled && (
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-gray-600">Requerido:</label>
                              <Checkbox
                                checked={field.isRequired}
                                onCheckedChange={(checked) => toggleRequired(field.id, !!checked)}
                                disabled={saving}
                                className="w-3 h-3"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Info Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-900">¿Cómo funciona?</h3>
              <p className="text-sm text-blue-700 mt-1">
                Los campos predefinidos incluyen opciones comunes que puedes activar fácilmente. 
                Una vez activados, aparecerán automáticamente en tus formularios de ventas.
                Puedes marcar campos como "Requeridos" para que sean obligatorios.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
