'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Checkbox } from '@/app/components/ui/checkbox';
import { useToast } from '@/app/hooks/use-toast';
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
  Edit,
  Trash2,
  Database,
  Sparkles,
  Wand2,
  Truck,
  Building,
  List,
  BarChart3
} from 'lucide-react';

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

interface CustomField {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  optionSetId?: string;
  multiSelect: boolean;
  active: boolean;
}

interface BusinessField {
  id: string;
  name: string;
  type: string;
  label: string;
  placeholder?: string;
  options?: string;
  required: boolean;
  order: number;
  isActive: boolean;
}

interface OptionSet {
  id: string;
  key: string;
  name: string;
  active: boolean;
  options?: Array<{
    id: string;
    label: string;
    value: string;
    priceDelta: number;
  }>;
}

interface ShippingMethod {
  id: string;
  name: string;
  carrier?: string;
  basePrice: number;
  active: boolean;
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
    id: 'marca',
    key: 'marca',
    label: 'Marca',
    type: 'text',
    description: 'Marca del producto',
    icon: Tag,
    category: 'appearance',
    isEnabled: false,
    isRequired: false,
    order: 4
  },
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
    order: 5,
    options: [
      { label: 'Clásico', value: 'clasico' },
      { label: 'Moderno', value: 'moderno' },
      { label: 'Vintage', value: 'vintage' },
      { label: 'Deportivo', value: 'deportivo' },
      { label: 'Elegante', value: 'elegante' },
      { label: 'Casual', value: 'casual' }
    ]
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
    id: 'garantia',
    key: 'garantia',
    label: 'Garantía',
    type: 'select',
    description: 'Período de garantía',
    icon: CheckCircle,
    category: 'details',
    isEnabled: false,
    isRequired: false,
    order: 7,
    options: [
      { label: 'Sin garantía', value: 'sin_garantia' },
      { label: '30 días', value: '30_dias' },
      { label: '90 días', value: '90_dias' },
      { label: '1 año', value: '1_ano' },
      { label: '2 años', value: '2_anos' },
      { label: 'Lifetime', value: 'lifetime' }
    ]
  }
];

const PRESET_BUSINESS_FIELDS = [
  {
    id: 'negocio',
    key: 'negocio',
    label: 'Tipo de Negocio',
    type: 'dropdown',
    description: 'Tipo de negocio del cliente',
    icon: Building,
    category: 'business',
    isEnabled: false,
    isRequired: false,
    order: 1,
    options: [
      { label: 'Retail', value: 'retail' },
      { label: 'Mayorista', value: 'mayorista' },
      { label: 'Distribuidor', value: 'distribuidor' },
      { label: 'Exportador', value: 'exportador' }
    ]
  },
  {
    id: 'canal_venta',
    key: 'canal_venta',
    label: 'Canal de Venta',
    type: 'dropdown',
    description: 'Canal por el cual se realizó la venta',
    icon: BarChart3,
    category: 'business',
    isEnabled: false,
    isRequired: false,
    order: 2,
    options: [
      { label: 'Facebook', value: 'facebook' },
      { label: 'Instagram', value: 'instagram' },
      { label: 'WhatsApp', value: 'whatsapp' },
      { label: 'Referido', value: 'referido' },
      { label: 'Tienda Física', value: 'tienda_fisica' }
    ]
  }
];

const PRESET_SHIPPING_METHODS = [
  {
    id: 'correos_cr',
    key: 'correos_cr',
    name: 'Correos de Costa Rica',
    carrier: 'Correos de Costa Rica',
    basePrice: 2000,
    description: 'Servicio postal nacional',
    icon: Truck,
    isEnabled: false
  },
  
];

export function UnifiedFieldsManager() {
  const [presetFields, setPresetFields] = useState<PresetField[]>(PRESET_FIELDS);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [businessFields, setBusinessFields] = useState<BusinessField[]>([]);
  const [optionSets, setOptionSets] = useState<OptionSet[]>([]);
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
  const [presetBusinessFields, setPresetBusinessFields] = useState(PRESET_BUSINESS_FIELDS);
  const [presetShippingMethods, setPresetShippingMethods] = useState(PRESET_SHIPPING_METHODS);
  const [orderStatuses, setOrderStatuses] = useState<Array<{id: string; key: string; label: string; color?: string; order: number;}>>([]);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [showStatusForm, setShowStatusForm] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [editingBusinessField, setEditingBusinessField] = useState<BusinessField | null>(null);
  const [editingOptionSet, setEditingOptionSet] = useState<OptionSet | null>(null);
  const [editingShipping, setEditingShipping] = useState<ShippingMethod | null>(null);
  const [activeSection, setActiveSection] = useState<'product' | 'business' | 'shipping' | 'options' | 'statuses'>('product');
  
  // Form states
  const [formData, setFormData] = useState<any>({});
  const [optionSetOptions, setOptionSetOptions] = useState<Array<{label: string, value: string, priceDelta: number}>>([]);
  const { toast } = useToast();

  useEffect(() => {
    loadCurrentFields();
  }, []);

  const loadCurrentFields = async () => {
    try {
      setLoading(true);
      
      // Load all configuration data in parallel
      const [fieldsRes, businessRes, optionSetsRes, shippingRes, statusRes] = await Promise.all([
        fetch('/api/config/fields').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
        fetch('/api/config/business-info').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
        fetch('/api/config/option-sets').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
        fetch('/api/config/shipping').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
        fetch('/api/config/status').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
      ]);

      // Process product fields
      if (fieldsRes.status === 'success') {
        const currentFields = fieldsRes.data;
        
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
        
        // Set custom fields (fields not in presets)
        const customFieldsData = currentFields.filter((field: any) => 
          !PRESET_FIELDS.some(preset => preset.key === field.key)
        );
        setCustomFields(customFieldsData);
      }

      // Process business fields
      if (businessRes.status === 'success') {
        setBusinessFields(businessRes.data);
        
        // Update preset business fields
        setPresetBusinessFields(prev => prev.map(preset => {
          const currentField = businessRes.data.find((f: any) => f.name === preset.key);
          return {
            ...preset,
            isEnabled: !!currentField,
            isRequired: currentField?.required || false,
            order: currentField?.order || preset.order
          };
        }));
      }

      // Process option sets
      if (optionSetsRes.status === 'success') {
        setOptionSets(optionSetsRes.data);
      }

      // Process shipping methods
      if (shippingRes.status === 'success') {
        setShippingMethods(shippingRes.data);
        
        // Update preset shipping methods
        setPresetShippingMethods(prev => prev.map(preset => {
          const currentMethod = shippingRes.data.find((m: any) => m.name === preset.name);
          return {
            ...preset,
            isEnabled: !!currentMethod
          };
        }));
      }

      // Process order statuses
      if (statusRes.status === 'success') {
        setOrderStatuses(statusRes.data);
      }
    } catch (error) {
      console.error('Error loading current fields:', error);
    } finally {
      setLoading(false);
    }
  };

  const togglePresetProductField = async (fieldId: string, enabled: boolean) => {
    const field = presetFields.find(f => f.id === fieldId);
    if (!field) return;

    setSaving(true);
    try {
      if (enabled) {
        // First check if the field already exists
        console.log('Checking if field already exists:', field.key);
        const existingFieldsResponse = await fetch('/api/config/fields');
        if (existingFieldsResponse.ok) {
          const existingFieldsData = await existingFieldsResponse.json();
          if (existingFieldsData.status === 'success') {
            const existingField = existingFieldsData.data.find((f: any) => f.key === field.key);
            if (existingField) {
              console.log('Field already exists and is active, updating UI...');
              // Field already exists and is active, just update UI
              setPresetFields(prev => prev.map(f => 
                f.id === fieldId ? { ...f, isEnabled: true } : f
              ));
              // Ensure select fields have an option set associated
              if (field.type === 'select' && field.options && !existingField.optionSetId) {
                try {
                  const setId = await createOptionSet(field);
                  await fetch('/api/config/fields', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: existingField.id, optionSetId: setId })
                  });
                } catch (e) {
                  console.warn('Failed to ensure optionSetId for existing field:', e);
                }
              }
              await loadCurrentFields();
              return;
            }
          }
        }

        // Field doesn't exist or is inactive, try to create it
        const fieldData = {
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.isRequired,
          order: field.order,
          optionSetId: null,
          multiSelect: false
        };
        
        console.log('Creating new field with data:', fieldData);
        
        const response = await fetch('/api/config/fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fieldData)
        });

        if (response.ok) {
          // Field was created successfully
          const createdField = await response.json();
          console.log('Field created successfully:', createdField);
          
          // If it's a select field, create the option set
          if (field.type === 'select' && field.options) {
            try {
              const setId = await createOptionSet(field);
              // Link option set to field
              await fetch('/api/config/fields', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: createdField.data.id, optionSetId: setId })
              });
            } catch (optionError) {
              console.error('Error creating option set, but field was created:', optionError);
              toast({ title: 'Opciones no creadas completamente', description: 'El campo fue creado, pero algunas opciones ya existían o fallaron.' });
            }
          }
          
          setPresetFields(prev => prev.map(f => 
            f.id === fieldId ? { ...f, isEnabled: true } : f
          ));
          
          await loadCurrentFields();
        } else {
          // Field creation failed
          const errorData = await response.json();
          console.error('Field creation failed:', errorData);
          alert('Error al crear el campo: ' + (errorData.message || 'Error desconocido'));
        }
      } else {
        // Find the field to delete
        const fieldsResponse = await fetch('/api/config/fields');
        if (!fieldsResponse.ok) {
          alert('Error al obtener los campos');
          return;
        }
        
        const fieldsData = await fieldsResponse.json();
        if (fieldsData.status !== 'success') {
          alert('Error al obtener los campos');
          return;
        }
        
        // Find the field with matching key
        const actualField = fieldsData.data.find((f: any) => f.key === field.key);
        if (!actualField) {
          alert('No se encontró el campo en la base de datos');
          return;
        }

        // Delete the field using the actual database ID
        const response = await fetch(`/api/config/fields?id=${actualField.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
          setPresetFields(prev => prev.map(f => 
            f.id === fieldId ? { ...f, isEnabled: false } : f
          ));
          
          await loadCurrentFields();
        } else {
          const errorData = await response.json();
          alert('Error al desactivar el campo: ' + (errorData.message || 'Error desconocido'));
        }
      }
    } catch (error) {
      console.error('Error toggling field:', error);
      alert('Error al cambiar el estado del campo');
    } finally {
      setSaving(false);
    }
  };

  const togglePresetBusinessField = async (presetId: string, enabled: boolean) => {
    const preset = presetBusinessFields.find(f => f.id === presetId);
    if (!preset) return;

    setSaving(true);
    try {
      if (enabled) {
        const existingRes = await fetch('/api/config/business-info');
        if (existingRes.ok) {
          const existingData = await existingRes.json();
          if (existingData.status === 'success') {
            const exists = existingData.data.find((f: any) => f.name === preset.key);
            if (exists) {
              setPresetBusinessFields(prev => prev.map(p => p.id === presetId ? { ...p, isEnabled: true } : p));
              await loadCurrentFields();
              return;
            }
          }
        }

        // Normalize preset options (array of strings)
        const normalizedOptions = Array.isArray(preset.options)
          ? preset.options.map((opt: any) => typeof opt === 'string' ? opt : (opt?.label || opt?.value)).filter(Boolean)
          : null;

        const response = await fetch('/api/config/business-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: preset.key,
            type: preset.type,
            label: preset.label,
            placeholder: '',
            options: normalizedOptions,
            required: preset.isRequired || false,
            order: preset.order || 0
          })
        });

        if (response.ok) {
          setPresetBusinessFields(prev => prev.map(p => p.id === presetId ? { ...p, isEnabled: true } : p));
          await loadCurrentFields();
        } else {
          const errorData = await response.json();
          alert('Error al activar el campo de negocio: ' + (errorData.message || 'Error desconocido'));
        }
      } else {
        const res = await fetch('/api/config/business-info');
        if (!res.ok) {
          alert('Error al obtener campos de negocio');
          return;
        }
        const data = await res.json();
        if (data.status !== 'success') {
          alert('Error al obtener campos de negocio');
          return;
        }
        const existing = data.data.find((f: any) => f.name === preset.key);
        if (!existing) {
          alert('No se encontró el campo de negocio en la base de datos');
          return;
        }
        const del = await fetch(`/api/config/business-info?id=${existing.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
        if (del.ok) {
          setPresetBusinessFields(prev => prev.map(p => p.id === presetId ? { ...p, isEnabled: false } : p));
          await loadCurrentFields();
        } else {
          const errorData = await del.json();
          alert('Error al desactivar el campo de negocio: ' + (errorData.message || 'Error desconocido'));
        }
      }
    } catch (error) {
      console.error('Error toggling business field:', error);
      alert('Error al cambiar el estado del campo de negocio');
    } finally {
      setSaving(false);
    }
  };

  const togglePresetShippingMethod = async (presetId: string, enabled: boolean) => {
    const preset = presetShippingMethods.find(m => m.id === presetId);
    if (!preset) return;

    setSaving(true);
    try {
      if (enabled) {
        const existingRes = await fetch('/api/config/shipping');
        if (existingRes.ok) {
          const existingData = await existingRes.json();
          if (existingData.status === 'success') {
            const exists = existingData.data.find((m: any) => m.name === preset.name);
            if (exists) {
              setPresetShippingMethods(prev => prev.map(p => p.id === presetId ? { ...p, isEnabled: true } : p));
              await loadCurrentFields();
              return;
            }
          }
        }

        const response = await fetch('/api/config/shipping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: preset.name,
            carrier: preset.carrier || null,
            basePrice: preset.basePrice,
            active: true
          })
        });

        if (response.ok) {
          setPresetShippingMethods(prev => prev.map(p => p.id === presetId ? { ...p, isEnabled: true } : p));
          await loadCurrentFields();
        } else {
          const errorData = await response.json();
          alert('Error al activar el método de envío: ' + (errorData.message || 'Error desconocido'));
        }
      } else {
        const res = await fetch('/api/config/shipping');
        if (!res.ok) {
          alert('Error al obtener métodos de envío');
          return;
        }
        const data = await res.json();
        if (data.status !== 'success') {
          alert('Error al obtener métodos de envío');
          return;
        }
        const existing = data.data.find((m: any) => m.name === preset.name);
        if (!existing) {
          alert('No se encontró el método de envío en la base de datos');
          return;
        }
        const del = await fetch(`/api/config/shipping?id=${existing.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
        if (del.ok) {
          setPresetShippingMethods(prev => prev.map(p => p.id === presetId ? { ...p, isEnabled: false } : p));
          await loadCurrentFields();
        } else {
          const errorData = await del.json();
          alert('Error al desactivar el método de envío: ' + (errorData.message || 'Error desconocido'));
        }
      }
    } catch (error) {
      console.error('Error toggling shipping method:', error);
      alert('Error al cambiar el estado del método de envío');
    } finally {
      setSaving(false);
    }
  };

  const createOptionSet = async (field: PresetField): Promise<string> => {
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

      let optionSetData: any;
      if (!optionSetResponse.ok) {
        const errorData = await optionSetResponse.json();
        // If already exists (treated as success by API), proceed to fetch existing id
        console.warn('Option set create non-200, proceeding if 409/exists:', errorData);
        const existingSets = await fetch('/api/config/option-sets').then(r => r.json());
        const existing = existingSets?.data?.find((s: any) => s.key === field.key);
        if (!existing) {
          throw new Error(errorData?.message || errorData?.error || 'Unknown error');
        }
        optionSetData = { data: existing };
      } else {
        optionSetData = await optionSetResponse.json();
      }
      console.log('Option set created:', optionSetData);
      
      // Then create the options
      for (const option of field.options || []) {
        const optionResponse = await fetch('/api/config/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            setId: optionSetData.data.id,
            label: option.label,
            value: option.value,
            priceDelta: option.priceDelta || 0
          })
        });

        if (!optionResponse.ok) {
          // Skip duplicates or minor failures silently, log for debugging
          const errorData = await optionResponse.json();
          console.warn('Option create failed, skipping:', errorData);
        }
      }
      return optionSetData.data.id as string;
    } catch (error) {
      console.error('Error creating option set:', error);
      throw error; // Re-throw to be handled by the caller
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

  const handleDeleteField = async (fieldId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este campo?')) return;
    
    try {
      const response = await fetch(`/api/config/fields?id=${fieldId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        await loadCurrentFields();
      } else {
        const errorData = await response.json();
        console.error('Delete error:', errorData);
        alert('Error al eliminar el campo: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error deleting field:', error);
      alert('Error al eliminar el campo');
    }
  };

  const handleDeleteBusinessField = async (fieldId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este campo de negocio?')) return;
    
    try {
      const response = await fetch(`/api/config/business-info?id=${fieldId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        await loadCurrentFields();
      } else {
        const errorData = await response.json();
        console.error('Delete business field error:', errorData);
        alert('Error al eliminar el campo de negocio: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error deleting business field:', error);
      alert('Error al eliminar el campo de negocio');
    }
  };

  const handleDeleteOptionSet = async (setId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este conjunto de opciones?')) return;
    
    try {
      const response = await fetch(`/api/config/option-sets?id=${setId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        await loadCurrentFields();
      } else {
        const errorData = await response.json();
        console.error('Delete option set error:', errorData);
        alert('Error al eliminar el conjunto de opciones: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error deleting option set:', error);
      alert('Error al eliminar el conjunto de opciones');
    }
  };

  const handleDeleteShipping = async (shippingId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este método de envío?')) return;
    
    try {
      const response = await fetch(`/api/config/shipping?id=${shippingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        await loadCurrentFields();
      } else {
        const errorData = await response.json();
        console.error('Delete shipping error:', errorData);
        alert('Error al eliminar el método de envío: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error deleting shipping method:', error);
      alert('Error al eliminar el método de envío');
    }
  };

  const handleEditBusinessField = (field: BusinessField) => {
    setEditingBusinessField(field);
    setShowCustomForm(true);
  };

  const handleEditOptionSet = (set: OptionSet) => {
    setEditingOptionSet(set);
    setShowCustomForm(true);
  };

  const handleEditShipping = (shipping: ShippingMethod) => {
    setEditingShipping(shipping);
    setShowCustomForm(true);
  };

  // Save handlers
  const handleSaveField = async (data: any) => {
    setSaving(true);
    try {
      const isEdit = Boolean(data.id);
      const method = isEdit ? 'PUT' : 'POST';
      const response = await fetch('/api/config/fields', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        await loadCurrentFields();
        setShowCustomForm(false);
        setEditingField(null);
      } else {
        const errorData = await response.json();
        alert('Error al guardar el campo: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error saving field:', error);
      alert('Error al guardar el campo');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBusinessField = async (data: any) => {
    setSaving(true);
    try {
      const payload: any = { ...data };
      if (typeof data.options === 'string' && data.type === 'dropdown') {
        payload.options = data.options
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
      const isEdit = Boolean(data.id);
      const method = isEdit ? 'PUT' : 'POST';
      const response = await fetch('/api/config/business-info', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        await loadCurrentFields();
        setShowCustomForm(false);
        setEditingBusinessField(null);
      } else {
        const errorData = await response.json();
        alert('Error al guardar el campo de negocio: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error saving business field:', error);
      alert('Error al guardar el campo de negocio');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveShipping = async (data: any) => {
    setSaving(true);
    try {
      const isEdit = Boolean(data.id);
      const method = isEdit ? 'PUT' : 'POST';
      const response = await fetch('/api/config/shipping', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        await loadCurrentFields();
        setShowCustomForm(false);
        setEditingShipping(null);
      } else {
        const errorData = await response.json();
        alert('Error al guardar el método de envío: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error saving shipping:', error);
      alert('Error al guardar el método de envío');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOptionSet = async (data: any) => {
    setSaving(true);
    try {
      const isEdit = Boolean(data.id);
      const method = isEdit ? 'PUT' : 'POST';
      const response = await fetch('/api/config/option-sets', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        await loadCurrentFields();
        setShowCustomForm(false);
        setEditingOptionSet(null);
      } else {
        const errorData = await response.json();
        alert('Error al guardar el conjunto de opciones: ' + (errorData.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('Error saving option set:', error);
      alert('Error al guardar el conjunto de opciones');
    } finally {
      setSaving(false);
    }
  };

  const categories = [
    { key: 'basic', label: 'Campos Básicos', description: 'Información esencial del producto' },
    { key: 'appearance', label: 'Apariencia', description: 'Características visuales' },
    { key: 'details', label: 'Detalles Técnicos', description: 'Especificaciones técnicas' }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Cargando campos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-700 to-slate-800 p-6 rounded-xl text-white shadow-lg">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white bg-opacity-10 rounded-xl backdrop-blur-sm">
            <Database className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Configuración del Sistema</h2>
            <p className="text-slate-200">Gestiona campos, envíos y opciones de tu CRM</p>
          </div>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex">
          {[
            { id: 'product', label: 'Producto', shortLabel: 'Producto', icon: Package, color: 'blue' },
            { id: 'business', label: 'Negocio', shortLabel: 'Negocio', icon: Building, color: 'green' },
            { id: 'shipping', label: 'Envío', shortLabel: 'Envío', icon: Truck, color: 'orange' },
            { id: 'options', label: 'Opciones', shortLabel: 'Opciones', icon: List, color: 'purple' },
            { id: 'statuses', label: 'Estados', shortLabel: 'Estados', icon: CheckCircle, color: 'gray' },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSection === tab.id;
            const colorClasses = {
              blue: isActive ? 'bg-blue-500 text-white' : 'text-blue-600 hover:bg-blue-50',
              green: isActive ? 'bg-green-500 text-white' : 'text-green-600 hover:bg-green-50',
              orange: isActive ? 'bg-orange-500 text-white' : 'text-orange-600 hover:bg-orange-50',
              purple: isActive ? 'bg-purple-500 text-white' : 'text-purple-600 hover:bg-purple-50'
            };
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as any)}
                className={`flex-1 py-4 px-6 text-sm font-medium transition-all duration-200 border-r border-gray-200 last:border-r-0 ${
                  colorClasses[tab.color as keyof typeof colorClasses]
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  <Icon className="w-5 h-5" />
                  <span className="hidden sm:block">{tab.label}</span>
                  <span className="sm:hidden text-xs">{tab.shortLabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content based on active section */}
      {activeSection === 'product' && (
        <div className="space-y-6">
          {/* Quick Setup Section */}
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-green-50 to-blue-50 border-b">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Sparkles className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <CardTitle className="text-lg text-gray-900">Configuración Rápida</CardTitle>
                  <p className="text-sm text-gray-600">Activa los campos más comunes con un solo clic</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {/* Categories */}
              {categories.map(category => {
                const categoryFields = presetFields.filter(f => f.category === category.key);
                const enabledCount = categoryFields.filter(f => f.isEnabled).length;
                const CategoryIcon = getCategoryIcon(category.key);
                
                return (
                  <div key={category.key} className="mb-6 last:mb-0">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-100 rounded-lg">
                          <CategoryIcon className="w-5 h-5 text-gray-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{category.label}</h3>
                          <p className="text-sm text-gray-600">{category.description}</p>
                        </div>
                      </div>
                      <Badge className={getCategoryColor(category.key)}>
                        {enabledCount} / {categoryFields.length} activos
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                              <div className="flex items-start gap-3 flex-1">
                                <div className={`p-2 rounded-lg ${
                                  field.isEnabled ? 'bg-green-100' : 'bg-gray-100'
                                }`}>
                                  <Icon className={`w-5 h-5 ${
                                    field.isEnabled ? 'text-green-600' : 'text-gray-600'
                                  }`} />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-medium text-gray-900">{field.label}</h4>
                                    {field.isEnabled && (
                                      <CheckCircle className="w-4 h-4 text-green-600" />
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-600 mt-1">{field.description}</p>
                                  {field.options && (
                                    <p className="text-xs text-gray-500 mt-1">
                                      {field.options.length} opciones predefinidas
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <Checkbox
                                  checked={field.isEnabled}
                                  onCheckedChange={(checked) => togglePresetProductField(field.id, !!checked)}
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
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Custom Fields Section */}
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Wand2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-gray-900">Campos Personalizados</CardTitle>
                    <p className="text-sm text-gray-600">Campos creados manualmente</p>
                  </div>
                </div>
                <Button
                  onClick={() => setShowCustomForm(true)}
                  variant="outline"
                  className="border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nuevo Campo
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {/* Help Info Box */}
              <div className="mb-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Info className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-purple-900 mb-2">💡 Usando Conjuntos de Opciones</h4>
                    <div className="text-sm text-purple-800 space-y-1">
                      <p><strong>1.</strong> Crea campos personalizados de tipo <strong>"Lista desplegable"</strong></p>
                      <p><strong>2.</strong> Selecciona un <strong>Conjunto de Opciones</strong> existente para ese campo</p>
                      <p><strong>3.</strong> Las opciones del conjunto aparecerán automáticamente en tus formularios</p>
                      <p className="text-xs text-purple-600 mt-2">
                        ℹ️ Si no tienes conjuntos de opciones, crea uno primero en la pestaña "Conjuntos de Opciones"
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              {customFields.length === 0 ? (
                <div className="text-center py-8">
                  <Wand2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 mb-4">No hay campos personalizados creados</p>
                  <Button
                    onClick={() => setShowCustomForm(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Crear Primer Campo
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {customFields.map((field) => {
                    const fieldOptionSet = field.optionSetId ? optionSets.find(os => os.id === field.optionSetId) : null;
                    return (
                      <div key={field.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <Database className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{field.label}</div>
                            <div className="text-sm text-gray-500">
                              {field.type} • {field.required ? 'Requerido' : 'Opcional'} • Orden: {field.order}
                              {field.type === 'select' && fieldOptionSet && (
                                <span className="ml-2 text-purple-600">
                                  • Conjunto: {fieldOptionSet.name}
                                </span>
                              )}
                              {field.type === 'select' && !fieldOptionSet && field.optionSetId && (
                                <span className="ml-2 text-red-600">
                                  • Conjunto no encontrado
                                </span>
                              )}
                              {field.multiSelect && (
                                <span className="ml-2 text-blue-600">• Multiselección</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => { setEditingField(field); setShowCustomForm(true); }}
                            variant="outline"
                            size="sm"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Editar
                          </Button>
                          <Button
                            onClick={() => handleDeleteField(field.id)}
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Business Fields Section */}
      {activeSection === 'business' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-500 to-cyan-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                    <Building className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Campos de Información de Negocio</h2>
                    <p className="text-blue-100">Gestiona los campos personalizados para tu negocio</p>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setEditingBusinessField(null);
                    setShowCustomForm(true);
                  }}
                  className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white border-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nuevo Campo
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {/* Existing Business Fields */}
              {businessFields.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Campos Personalizados</h3>
                  <div className="space-y-3">
                    {businessFields.map((field) => (
                      <div key={field.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <Building className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{field.label}</div>
                            <div className="text-sm text-gray-500">
                              {field.type} • {field.required ? 'Requerido' : 'Opcional'} • Orden: {field.order}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handleEditBusinessField(field)}
                            variant="outline"
                            size="sm"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Editar
                          </Button>
                          <Button
                            onClick={() => handleDeleteBusinessField(field.id)}
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preset Business Fields */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Campos Predefinidos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {presetBusinessFields.map(field => {
                  const Icon = field.icon;
                  return (
                    <div
                      key={field.id}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        field.isEnabled 
                          ? 'border-blue-200 bg-blue-50' 
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className={`p-2 rounded-lg ${
                            field.isEnabled ? 'bg-blue-100' : 'bg-gray-100'
                          }`}>
                            <Icon className={`w-5 h-5 ${
                              field.isEnabled ? 'text-blue-600' : 'text-gray-600'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-gray-900">{field.label}</h4>
                              {field.isEnabled && (
                                <CheckCircle className="w-4 h-4 text-blue-600" />
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">{field.description}</p>
                            {field.options && (
                              <p className="text-xs text-gray-500 mt-1">
                                {field.options.length} opciones predefinidas
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Checkbox
                            checked={field.isEnabled}
                            onCheckedChange={(checked) => togglePresetBusinessField(field.id, !!checked)}
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
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Shipping Methods Section */}
      {activeSection === 'shipping' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-orange-500 to-amber-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                    <Truck className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Métodos de Envío</h2>
                    <p className="text-orange-100">Gestiona las opciones de envío disponibles</p>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setEditingShipping(null);
                    setShowCustomForm(true);
                  }}
                  className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white border-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nuevo Método
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {/* Existing Shipping Methods */}
              {shippingMethods.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Métodos Configurados</h3>
                  <div className="space-y-3">
                    {shippingMethods.map((method) => (
                      <div key={method.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-orange-100 rounded-lg">
                            <Truck className="w-5 h-5 text-orange-600" />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{method.name}</div>
                            <div className="text-sm text-gray-500">
                              {method.carrier} • ₡{method.basePrice.toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handleEditShipping(method)}
                            variant="outline"
                            size="sm"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Editar
                          </Button>
                          <Button
                            onClick={() => handleDeleteShipping(method.id)}
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preset Shipping Methods */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Métodos Predefinidos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {presetShippingMethods.map(method => {
                  const Icon = method.icon;
                  return (
                    <div
                      key={method.id}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        method.isEnabled 
                          ? 'border-orange-200 bg-orange-50' 
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className={`p-2 rounded-lg ${
                            method.isEnabled ? 'bg-orange-100' : 'bg-gray-100'
                          }`}>
                            <Icon className={`w-5 h-5 ${
                              method.isEnabled ? 'text-orange-600' : 'text-gray-600'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-gray-900">{method.name}</h4>
                              {method.isEnabled && (
                                <CheckCircle className="w-4 h-4 text-orange-600" />
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mt-1">{method.description}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              Precio base: ₡{method.basePrice.toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Checkbox
                            checked={method.isEnabled}
                            onCheckedChange={(checked) => togglePresetShippingMethod(method.id, !!checked)}
                            disabled={saving}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Option Sets Section */}
      {activeSection === 'options' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-purple-500 to-violet-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                    <List className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Conjuntos de Opciones</h2>
                    <p className="text-purple-100">Gestiona las opciones disponibles para los campos</p>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setEditingOptionSet(null);
                    setShowCustomForm(true);
                  }}
                  className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white border-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nuevo Conjunto
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {optionSets.length === 0 ? (
                <div className="text-center py-8">
                  <List className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 mb-4">No hay conjuntos de opciones configurados</p>
                  <Button
                    onClick={() => {
                      setEditingOptionSet(null);
                      setShowCustomForm(true);
                    }}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Crear Primer Conjunto
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {optionSets.map((set) => (
                    <div key={set.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <List className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{set.name}</div>
                          <div className="text-sm text-gray-500">
                            Clave: {set.key} • {set.options?.length || 0} opciones
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => handleEditOptionSet(set)}
                          variant="outline"
                          size="sm"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Editar
                        </Button>
                        <Button
                          onClick={() => handleDeleteOptionSet(set.id)}
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Order Statuses Section */}
      {activeSection === 'statuses' && (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-gray-500 to-slate-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                    <CheckCircle className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Estados de Órdenes</h2>
                    <p className="text-gray-100">Configura el flujo de estados de producción</p>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setEditingOptionSet(null);
                    setShowStatusForm(true);
                    setFormData({ key: '', label: '', color: '', order: orderStatuses.length });
                  }}
                  className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white border-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nuevo Estado
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              {orderStatuses.map((st) => (
                <div key={st.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded text-xs ${st.color || 'bg-gray-200 text-gray-800'}`}>{st.label}</span>
                    <span className="text-xs text-gray-500">clave: {st.key}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowStatusForm(true);
                        setFormData({ id: st.id, key: st.key, label: st.label, color: st.color || '', order: st.order });
                      }}
                    >
                      <Edit className="w-4 h-4 mr-1" />Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600"
                      onClick={async () => {
                        if (!confirm('¿Eliminar estado?')) return;
                        await fetch(`/api/config/status?id=${st.id}`, { method: 'DELETE' });
                        await loadCurrentFields();
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />Eliminar
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Status Form Modal */}
          {showStatusForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowStatusForm(false)}>
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold">{formData?.id ? 'Editar Estado' : 'Nuevo Estado'}</h3>
                    <button onClick={() => setShowStatusForm(false)} className="text-gray-400 hover:text-gray-600">
                      <XCircle className="w-6 h-6" />
                    </button>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Clave</label>
                    <input className="w-full px-3 py-2 border rounded" value={formData.key || ''}
                      onChange={(e) => setFormData({ ...formData, key: e.target.value })} 
                      placeholder="ej: en_revision" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Etiqueta</label>
                    <input className="w-full px-3 py-2 border rounded" value={formData.label || ''}
                      onChange={(e) => setFormData({ ...formData, label: e.target.value })} 
                      placeholder="ej: En Revisión" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Color del Estado</label>
                    <div className="grid grid-cols-6 gap-2 mb-3">
                      {[
                        { name: 'Azul', class: 'bg-blue-500', hex: '#3B82F6' },
                        { name: 'Verde', class: 'bg-green-500', hex: '#22C55E' },
                        { name: 'Amarillo', class: 'bg-yellow-500', hex: '#EAB308' },
                        { name: 'Naranja', class: 'bg-orange-500', hex: '#F97316' },
                        { name: 'Rojo', class: 'bg-red-500', hex: '#EF4444' },
                        { name: 'Morado', class: 'bg-purple-500', hex: '#A855F7' },
                        { name: 'Rosa', class: 'bg-pink-500', hex: '#EC4899' },
                        { name: 'Índigo', class: 'bg-indigo-500', hex: '#6366F1' },
                        { name: 'Cyan', class: 'bg-cyan-500', hex: '#06B6D4' },
                        { name: 'Gris', class: 'bg-gray-500', hex: '#6B7280' },
                        { name: 'Esmeralda', class: 'bg-emerald-500', hex: '#10B981' },
                        { name: 'Lima', class: 'bg-lime-500', hex: '#84CC16' }
                      ].map((color) => (
                        <button
                          key={color.class}
                          type="button"
                          onClick={() => setFormData({ ...formData, color: color.class })}
                          className={`h-10 rounded-lg ${color.class} hover:scale-110 transition-transform ${
                            formData.color === color.class ? 'ring-4 ring-offset-2 ring-gray-400' : ''
                          }`}
                          title={color.name}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Vista previa:</span>
                      {formData.color && (
                        <span className={`px-3 py-1 rounded text-white text-sm font-medium ${formData.color || 'bg-gray-300'}`}>
                          {formData.label || 'Estado de ejemplo'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Orden</label>
                    <input type="number" className="w-full px-3 py-2 border rounded" value={formData.order || 0}
                      onChange={(e) => setFormData({ ...formData, order: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setShowStatusForm(false)}>Cancelar</Button>
                    <Button onClick={async () => {
                      const method = formData.id ? 'PUT' : 'POST'
                      await fetch('/api/config/status', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) })
                      setShowStatusForm(false)
                      setFormData({})
                      await loadCurrentFields()
                    }}>Guardar</Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Info className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-blue-900 mb-2">¿Cómo funciona?</h3>
            <div className="space-y-2 text-sm text-blue-800">
              <p><strong>Configuración Rápida:</strong> Activa campos comunes con opciones predefinidas.</p>
              <p><strong>Campos Personalizados:</strong> Crea campos únicos para tu negocio.</p>
              <p><strong>Resultado:</strong> Todos los campos aparecerán automáticamente en tus formularios de ventas.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Form Modal */}
      {showCustomForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {activeSection === 'product' && (editingField ? 'Editar Campo' : 'Nuevo Campo')}
                  {activeSection === 'business' && (editingBusinessField ? 'Editar Campo de Negocio' : 'Nuevo Campo de Negocio')}
                  {activeSection === 'shipping' && (editingShipping ? 'Editar Método de Envío' : 'Nuevo Método de Envío')}
                  {activeSection === 'options' && (editingOptionSet ? 'Editar Conjunto de Opciones' : 'Nuevo Conjunto de Opciones')}
                </h3>
                <button
                  onClick={() => {
                    setShowCustomForm(false);
                    setEditingField(null);
                    setEditingBusinessField(null);
                    setEditingOptionSet(null);
                    setEditingShipping(null);
                    setFormData({});
                    setOptionSetOptions([]);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              {/* Form Content */}
              {activeSection === 'product' && (
                <ProductFieldForm
                  field={editingField}
                  optionSets={optionSets}
                  onSave={handleSaveField}
                  onCancel={() => setShowCustomForm(false)}
                  saving={saving}
                />
              )}

              {activeSection === 'business' && (
                <BusinessFieldForm
                  field={editingBusinessField}
                  onSave={handleSaveBusinessField}
                  onCancel={() => setShowCustomForm(false)}
                  saving={saving}
                />
              )}

              {activeSection === 'shipping' && (
                <ShippingForm
                  shipping={editingShipping}
                  onSave={handleSaveShipping}
                  onCancel={() => setShowCustomForm(false)}
                  saving={saving}
                />
              )}

              {activeSection === 'options' && (
                <OptionSetForm
                  optionSet={editingOptionSet}
                  onSave={handleSaveOptionSet}
                  onCancel={() => setShowCustomForm(false)}
                  saving={saving}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Form Components
function ProductFieldForm({ field, onSave, onCancel, saving, optionSets }: any) {
  const [formData, setFormData] = useState({
    id: field?.id || undefined,
    key: field?.key || '',
    label: field?.label || '',
    type: field?.type || 'text',
    required: field?.required || false,
    order: field?.order || 1,
    multiSelect: field?.multiSelect || false,
    optionSetId: field?.optionSetId || ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Clave del Campo</label>
        <input
          type="text"
          value={formData.key}
          onChange={(e) => setFormData({...formData, key: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Etiqueta</label>
        <input
          type="text"
          value={formData.label}
          onChange={(e) => setFormData({...formData, label: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Campo</label>
        <select
          value={formData.type}
          onChange={(e) => setFormData({...formData, type: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="select">Lista desplegable (con opciones)</option>
          <option value="checkbox">Casilla de verificación</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {formData.type === 'select' 
            ? '✨ Puedes seleccionar un conjunto de opciones predefinido abajo' 
            : 'Selecciona "Lista desplegable" para usar conjuntos de opciones'}
        </p>
      </div>

      {formData.type === 'select' && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-purple-900 mb-2">
            <List className="w-4 h-4 inline mr-1" />
            Conjunto de Opciones
          </label>
          {(optionSets || []).length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
              <p className="text-sm text-yellow-800 mb-2">
                ⚠️ No hay conjuntos de opciones disponibles
              </p>
              <a
                href="#options"
                onClick={(e) => { 
                  e.preventDefault(); 
                  const el = document.querySelector('[data-tab-id="options"]'); 
                  if (el) (el as HTMLElement).click(); 
                }}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Crear un conjunto de opciones primero →
              </a>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <select
                  value={formData.optionSetId}
                  onChange={(e) => setFormData({ ...formData, optionSetId: e.target.value })}
                  className="flex-1 px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                  required
                >
                  <option value="">-- Seleccionar conjunto de opciones --</option>
                  {(optionSets || []).filter((s: any) => s.active !== false).map((set: any) => (
                    <option key={set.id} value={set.id}>
                      {set.name} ({set.key}) {set.options?.length ? `- ${set.options.length} opciones` : ''}
                    </option>
                  ))}
                </select>
                <a
                  href="#options"
                  onClick={(e) => { 
                    e.preventDefault(); 
                    const el = document.querySelector('[data-tab-id="options"]'); 
                    if (el) (el as HTMLElement).click(); 
                  }}
                  className="text-sm px-3 py-2 border border-purple-300 rounded hover:bg-purple-100 text-purple-700 whitespace-nowrap"
                >
                  + Gestionar
                </a>
              </div>
              <p className="text-xs text-purple-600 mt-2">
                💡 El conjunto de opciones define las opciones disponibles en este campo desplegable
              </p>
              {formData.optionSetId && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                  ✓ Conjunto seleccionado. Las opciones de "{optionSets.find((s: any) => s.id === formData.optionSetId)?.name}" aparecerán en este campo.
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center space-x-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.required}
            onChange={(e) => setFormData({...formData, required: e.target.checked})}
            className="mr-2"
          />
          Campo requerido
        </label>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.multiSelect}
            onChange={(e) => setFormData({...formData, multiSelect: e.target.checked})}
            className="mr-2"
          />
          Selección múltiple
        </label>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <Button type="button" onClick={onCancel} variant="outline">
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}

function BusinessFieldForm({ field, onSave, onCancel, saving }: any) {
  const initialOptionsString = (() => {
    try {
      const raw = (field as any)?.options;
      if (!raw) return '';
      if (Array.isArray(raw)) return raw.join('\n');
      if (typeof raw === 'string') {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) return arr.join('\n');
          return raw;
        } catch {
          return raw;
        }
      }
      return '';
    } catch {
      return '';
    }
  })();

  const [formData, setFormData] = useState({
    id: field?.id || undefined,
    name: field?.name || '',
    type: field?.type || 'text',
    label: field?.label || '',
    placeholder: field?.placeholder || '',
    options: initialOptionsString,
    required: field?.required || false,
    order: field?.order || 1
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Campo</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Etiqueta</label>
        <input
          type="text"
          value={formData.label}
          onChange={(e) => setFormData({...formData, label: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Tipo</label>
        <select
          value={formData.type}
          onChange={(e) => setFormData({...formData, type: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
        >
          <option value="text">Texto</option>
          <option value="textarea">Área de texto</option>
          <option value="dropdown">Lista desplegable</option>
          <option value="date">Fecha</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Placeholder</label>
        <input
          type="text"
          value={formData.placeholder}
          onChange={(e) => setFormData({...formData, placeholder: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
      </div>

      {formData.type === 'dropdown' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Opciones (una por línea)</label>
          <textarea
            value={formData.options}
            onChange={(e) => setFormData({ ...formData, options: e.target.value })}
            placeholder={'Opción 1\nOpción 2\nOpción 3'}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent h-28"
          />
          <p className="text-xs text-gray-500 mt-1">Se guardará como lista de opciones para el menú desplegable.</p>
        </div>
      )}

      <div className="flex items-center space-x-4">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.required}
            onChange={(e) => setFormData({...formData, required: e.target.checked})}
            className="mr-2"
          />
          Campo requerido
        </label>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <Button type="button" onClick={onCancel} variant="outline">
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}

function ShippingForm({ shipping, onSave, onCancel, saving }: any) {
  const [formData, setFormData] = useState({
    id: shipping?.id || undefined,
    name: shipping?.name || '',
    carrier: shipping?.carrier || '',
    basePrice: shipping?.basePrice || 0,
    active: shipping?.active !== false
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Método</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Transportista</label>
        <input
          type="text"
          value={formData.carrier}
          onChange={(e) => setFormData({...formData, carrier: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Precio Base (₡)</label>
        <input
          type="number"
          value={formData.basePrice}
          onChange={(e) => setFormData({...formData, basePrice: parseFloat(e.target.value) || 0})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          min="0"
          step="0.01"
        />
      </div>

      <div className="flex items-center">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.active}
            onChange={(e) => setFormData({...formData, active: e.target.checked})}
            className="mr-2"
          />
          Método activo
        </label>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <Button type="button" onClick={onCancel} variant="outline">
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}

function OptionSetForm({ optionSet, onSave, onCancel, saving }: any) {
  const [formData, setFormData] = useState({
    key: optionSet?.key || '',
    name: optionSet?.name || ''
  });
  const [options, setOptions] = useState<Array<{label: string, value: string, priceDelta: number}>>(
    optionSet?.options || [{label: '', value: '', priceDelta: 0}]
  );

  const addOption = () => {
    setOptions([...options, {label: '', value: '', priceDelta: 0}]);
  };

  const removeOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  const updateOption = (index: number, field: string, value: any) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    setOptions(newOptions);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      options: options.filter(opt => opt.label && opt.value)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Clave del Conjunto</label>
        <input
          type="text"
          value={formData.key}
          onChange={(e) => setFormData({...formData, key: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Conjunto</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Opciones</label>
        <div className="space-y-3">
          {options.map((option, index) => (
            <div key={index} className="flex items-center space-x-3">
              <input
                type="text"
                placeholder="Etiqueta"
                value={option.label}
                onChange={(e) => updateOption(index, 'label', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <input
                type="text"
                placeholder="Valor"
                value={option.value}
                onChange={(e) => updateOption(index, 'value', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <input
                type="number"
                placeholder="Precio"
                value={option.priceDelta}
                onChange={(e) => updateOption(index, 'priceDelta', parseFloat(e.target.value) || 0)}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                step="0.01"
              />
              <button
                type="button"
                onClick={() => removeOption(index)}
                className="text-red-600 hover:text-red-800"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addOption}
          className="mt-2 text-purple-600 hover:text-purple-800 text-sm font-medium"
        >
          + Agregar Opción
        </button>
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <Button type="button" onClick={onCancel} variant="outline">
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}
