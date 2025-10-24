'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { useToast } from '@/app/hooks/use-toast';
import { SmartFieldWizard } from './SmartFieldWizard';
import { 
  Database,
  Plus,
  Edit,
  Trash2,
  Sparkles,
  Package,
  Building,
  Truck,
  Settings,
  Loader2,
  DollarSign
} from 'lucide-react';

interface Option {
  id: string;
  label: string;
  value: string;
  priceDelta: number;
  active: boolean;
}

interface Field {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  optionSetId?: string;
  multiSelect: boolean;
  active: boolean;
  category?: 'producto' | 'negocio' | 'envio';
  optionSet?: {
    id: string;
    name: string;
    key: string;
    options: Option[];
  };
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

export function SimpleFieldsManager() {
  const [fields, setFields] = useState<Field[]>([]);
  const [optionSets, setOptionSets] = useState<OptionSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [showCustomFieldForm, setShowCustomFieldForm] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [fieldOptions, setFieldOptions] = useState<Option[]>([]);
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [newOptionValue, setNewOptionValue] = useState('');
  const [newOptionPrice, setNewOptionPrice] = useState(0);
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [newFieldType, setNewFieldType] = useState('text'); // Track selected type for new field
  const [newFieldOptionSetId, setNewFieldOptionSetId] = useState(''); // Track option set for new field
  const [showQuickOptionSetCreator, setShowQuickOptionSetCreator] = useState(false); // Quick creator
  const [quickOptionSetName, setQuickOptionSetName] = useState('');
  const [quickOptionSetKey, setQuickOptionSetKey] = useState('');
  const [quickOptions, setQuickOptions] = useState<{label: string, value: string}[]>([{label: '', value: ''}]);
  const { toast } = useToast();

  const loadData = async () => {
    setLoading(true);
    try {
      const [fieldsRes, optionSetsRes] = await Promise.all([
        fetch('/api/config/fields').then(r => r.json()),
        fetch('/api/config/option-sets').then(r => r.json()),
      ]);

      if (fieldsRes.status === 'success') setFields(fieldsRes.data || []);
      if (optionSetsRes.status === 'success') setOptionSets(optionSetsRes.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron cargar los campos"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (editingField?.optionSetId && editingField.type === 'select') {
      loadFieldOptions(editingField.optionSetId);
    } else {
      setFieldOptions([]);
    }
  }, [editingField]);

  const handleFieldSelect = async (presetField: any) => {
    try {
      // Check if field already exists
      const existingField = fields.find(f => f.key === presetField.key);
      if (existingField) {
        toast({
          variant: "destructive",
          title: "Campo ya existe",
          description: `El campo "${presetField.label}" ya está configurado`
        });
        return;
      }

      // Create option set if field has options
      let optionSetId = null;
      if (presetField.options && presetField.options.length > 0) {
        const optionSetPayload = {
          key: presetField.key,
          name: presetField.label,
        };

        const optionSetRes = await fetch('/api/config/option-sets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(optionSetPayload)
        });

        const optionSetJson = await optionSetRes.json();
        if (optionSetJson.status === 'success') {
          optionSetId = optionSetJson.data.id;

          // Check if options already exist for this option set
          const existingOptionsRes = await fetch(`/api/config/options?setId=${optionSetId}`);
          const existingOptionsJson = await existingOptionsRes.json();
          const existingOptions = existingOptionsJson.status === 'success' ? existingOptionsJson.data : [];

          // Only create options if none exist
          if (existingOptions.length === 0) {
            // Create options one by one
            for (const opt of presetField.options) {
              try {
                await fetch('/api/config/options', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    setId: optionSetId,
                    label: opt.label,
                    value: opt.value,
                    priceDelta: opt.priceDelta || 0,
                    metadata: null
                  })
                });
              } catch (optError) {
                console.warn('Error creating option:', optError);
              }
            }
          } else {
            console.log(`Options already exist for ${presetField.label}, skipping creation`);
          }
        }
      }

      // Create field with category metadata
      const fieldPayload = {
        key: presetField.key,
        label: presetField.label,
        type: presetField.type,
        required: presetField.required || false,
        order: fields.length,
        optionSetId,
        multiSelect: false,
      };

      const fieldRes = await fetch('/api/config/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fieldPayload)
      });

      const fieldJson = await fieldRes.json();
      console.log('Field creation response:', fieldJson);
      if (fieldJson.status === 'success') {
        toast({
          title: "✅ Campo agregado",
          description: `${presetField.label} se agregó correctamente`
        });
        await loadData();
      } else {
        console.error('Field creation failed:', fieldJson);
        throw new Error(fieldJson.details || fieldJson.error || 'Error al crear campo');
      }
    } catch (error) {
      console.error('Error creating field:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo agregar el campo"
      });
    }
  };

  const handleDeleteField = async (id: string) => {
    if (!confirm('¿Eliminar este campo?')) return;
    
    try {
      const res = await fetch(`/api/config/fields?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      
      if (json.status === 'success') {
        toast({
          title: "✅ Campo eliminado",
          description: "El campo se eliminó correctamente"
        });
        await loadData();
      } else {
        throw new Error(json.error || 'Error al eliminar campo');
      }
    } catch (error) {
      console.error('Error deleting field:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar el campo"
      });
    }
  };

  const loadFieldOptions = async (optionSetId: string) => {
    try {
      const res = await fetch(`/api/config/options?setId=${optionSetId}`);
      const json = await res.json();
      if (json.status === 'success') {
        setFieldOptions(json.data);
      }
    } catch (error) {
      console.error('Error loading options:', error);
    }
  };

  const handleAddOption = async () => {
    if (!editingField?.optionSetId || !newOptionLabel) return;
    
    // Auto-generate value from label (lowercase, no spaces, no special chars)
    const autoValue = newOptionLabel
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9]+/g, '-')       // Replace non-alphanumeric with hyphens
      .replace(/^-+|-+$/g, '');          // Remove leading/trailing hyphens
    
    try {
      const res = await fetch('/api/config/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setId: editingField.optionSetId,
          label: newOptionLabel,
          value: autoValue,
          priceDelta: newOptionPrice || 0
        })
      });
      
      const json = await res.json();
      if (json.status === 'success') {
        toast({ title: "✅ Opción agregada" });
        setNewOptionLabel('');
        setNewOptionPrice(0);
        await loadFieldOptions(editingField.optionSetId);
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo agregar la opción" });
    }
  };

  const handleUpdateOption = async (optionId: string, label: string, value: string, priceDelta: number) => {
    try {
      const res = await fetch('/api/config/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: optionId, label, value, priceDelta })
      });
      
      const json = await res.json();
      if (json.status === 'success') {
        toast({ title: "✅ Opción actualizada" });
        setEditingOptionId(null);
        if (editingField?.optionSetId) {
          await loadFieldOptions(editingField.optionSetId);
        }
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo actualizar la opción" });
    }
  };

  const handleDeleteOption = async (optionId: string) => {
    if (!confirm('¿Eliminar esta opción?')) return;
    
    try {
      const res = await fetch(`/api/config/options?id=${optionId}`, { method: 'DELETE' });
      const json = await res.json();
      
      if (json.status === 'success') {
        toast({ title: "✅ Opción eliminada" });
        if (editingField?.optionSetId) {
          await loadFieldOptions(editingField.optionSetId);
        }
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo eliminar la opción" });
    }
  };

  const detectCategory = (field: Field): 'producto' | 'negocio' | 'envio' | undefined => {
    const key = field.key.toLowerCase();
    
    // Producto keywords
    if (['color', 'tamano', 'material', 'empaque', 'personalizacion', 'talla', 'tamaño'].some(k => key.includes(k))) {
      return 'producto';
    }
    
    // Negocio keywords
    if (['negocio', 'empresa', 'cedula', 'juridica', 'razon', 'social', 'contacto', 'telefono', 'email'].some(k => key.includes(k))) {
      return 'negocio';
    }
    
    // Envio keywords
    if (['provincia', 'canton', 'distrito', 'direccion', 'envio', 'entrega', 'metodo', 'costo', 'fecha', 'transportista'].some(k => key.includes(k))) {
      return 'envio';
    }
    
    return field.category;
  };

  const getCategoryIcon = (field: Field) => {
    const category = detectCategory(field);
    switch (category) {
      case 'producto': return Package;
      case 'negocio': return Building;
      case 'envio': return Truck;
      default: return Database;
    }
  };

  const getCategoryBadge = (field: Field) => {
    const category = detectCategory(field);
    switch (category) {
      case 'producto': return { label: 'Producto', color: 'bg-purple-100 text-purple-700' };
      case 'negocio': return { label: 'Negocio', color: 'bg-blue-100 text-blue-700' };
      case 'envio': return { label: 'Envío', color: 'bg-green-100 text-green-700' };
      default: return { label: 'Personalizado', color: 'bg-gray-100 text-gray-700' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-2 border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-100 rounded-xl">
                <Sparkles className="w-8 h-8 text-purple-600" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-gray-900">
                  Campos Personalizados
                </CardTitle>
                <p className="text-gray-600 mt-1">
                  Gestiona todos los campos de tu formulario de ventas
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowWizard(true)}
              size="lg"
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg"
            >
              <Plus className="w-5 h-5 mr-2" />
              Nuevo Campo
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Fields List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">
                Campos Activos
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                {fields.length} {fields.length === 1 ? 'campo configurado' : 'campos configurados'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              <span className="ml-3 text-gray-600">Cargando campos...</span>
            </div>
          ) : fields.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No hay campos configurados
              </h3>
              <p className="text-gray-500 mb-6">
                Comienza agregando campos predefinidos o crea uno personalizado
              </p>
              <Button
                onClick={() => setShowWizard(true)}
                size="lg"
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="w-5 h-5 mr-2" />
                Crear Primer Campo
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {fields.map((field) => {
                const Icon = getCategoryIcon(field);
                const categoryBadge = getCategoryBadge(field);
                
                return (
                  <div
                    key={field.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="p-2 bg-white rounded-lg shadow-sm">
                        <Icon className="w-5 h-5 text-gray-700" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">
                            {field.label}
                          </span>
                          <Badge className={categoryBadge.color}>
                            {categoryBadge.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-sm text-gray-500">
                            Tipo: <span className="font-medium">{field.type}</span>
                          </span>
                          <span className="text-sm text-gray-500">•</span>
                          <span className="text-sm text-gray-500">
                            {field.required ? (
                              <span className="text-red-600 font-medium">Requerido</span>
                            ) : (
                              <span className="text-gray-500">Opcional</span>
                            )}
                          </span>
                          {field.optionSetId && (
                            <>
                              <span className="text-sm text-gray-500">•</span>
                              <Badge variant="outline" className="text-xs">
                                Con opciones
                              </Badge>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingField(field)}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                      >
                        <Edit className="w-4 h-4 mr-1" />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteField(field.id)}
                        className="text-red-600 hover:text-red-800 hover:bg-red-50"
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

      {/* Smart Field Wizard */}
      <SmartFieldWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onFieldSelect={handleFieldSelect}
        onCustomField={() => {
          setShowWizard(false);
          setShowCustomFieldForm(true);
        }}
      />

      {/* Custom Field Form Modal */}
      {showCustomFieldForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-600" />
              Crear Campo Personalizado
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target as HTMLFormElement);
                const payload: any = {
                  key: formData.get('key'),
                  label: formData.get('label'),
                  type: newFieldType,
                  required: formData.get('required') === 'on',
                  order: fields.length,
                  multiSelect: false,
                  optionSetId: newFieldType === 'select' ? newFieldOptionSetId || null : null,
                };

                try {
                  // Validate that select fields have an option set
                  if (payload.type === 'select' && !payload.optionSetId) {
                    toast({
                      variant: "destructive",
                      title: "Falta conjunto de opciones",
                      description: "Los campos de tipo 'Selección' requieren un conjunto de opciones"
                    });
                    return;
                  }

                  const res = await fetch('/api/config/fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  const json = await res.json();
                  
                  if (json.status === 'success') {
                    toast({
                      title: "✅ Campo creado",
                      description: "El campo personalizado se creó correctamente"
                    });
                    setShowCustomFieldForm(false);
                    setNewFieldType('text'); // Reset
                    setNewFieldOptionSetId(''); // Reset
                    await loadData();
                  } else {
                    throw new Error(json.error || 'Error al crear campo');
                  }
                } catch (error) {
                  toast({
                    variant: "destructive",
                    title: "Error",
                    description: error instanceof Error ? error.message : "No se pudo crear el campo"
                  });
                }
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Clave única *
                  </label>
                  <input
                    type="text"
                    name="key"
                    required
                    pattern="[a-zA-Z0-9_]+"
                    title="Solo letras, números y guiones bajos"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="ej: miCampoPersonalizado"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Etiqueta *
                  </label>
                  <input
                    type="text"
                    name="label"
                    required
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="ej: Mi Campo Personalizado"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo *
                  </label>
                  <select
                    name="type"
                    required
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="text">Texto</option>
                    <option value="number">Número</option>
                    <option value="email">Email</option>
                    <option value="tel">Teléfono</option>
                    <option value="textarea">Área de texto</option>
                    <option value="select">Selección</option>
                  </select>
                  {newFieldType === 'select' && (
                    <p className="text-xs text-purple-600 mt-1">
                      ℹ️ Los campos de selección requieren un conjunto de opciones
                    </p>
                  )}
                </div>

                {/* Show option set selector when type is 'select' */}
                {newFieldType === 'select' && (
                  <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="block text-sm font-semibold text-gray-800 mb-1">
                          Conjunto de opciones *
                        </label>
                        <p className="text-xs text-gray-600">
                          Define las opciones disponibles para este campo desplegable
                        </p>
                      </div>
                    </div>

                    {!showQuickOptionSetCreator ? (
                      <>
                        <div className="flex gap-2">
                          <select
                            value={newFieldOptionSetId}
                            onChange={(e) => setNewFieldOptionSetId(e.target.value)}
                            className="flex-1 p-2.5 border-2 border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white shadow-sm font-medium"
                            required
                          >
                            <option value="">-- Seleccionar conjunto existente --</option>
                            {optionSets.map((set) => (
                              <option key={set.id} value={set.id}>
                                {set.name} {set.options?.length ? `(${set.options.length} opciones)` : '(vacío)'}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowQuickOptionSetCreator(true)}
                            className="flex-1 border-2 border-purple-400 text-purple-700 hover:bg-purple-100 font-semibold"
                          >
                            + Crear conjunto nuevo
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const optionsTab = document.querySelector('[data-section="options"]');
                              if (optionsTab) (optionsTab as HTMLElement).click();
                            }}
                            className="flex-1 border-2 border-indigo-400 text-indigo-700 hover:bg-indigo-100"
                          >
                            📋 Ver todos los conjuntos
                          </Button>
                        </div>

                        {!newFieldOptionSetId && (
                          <div className="bg-amber-50 border-l-4 border-amber-400 p-3 rounded">
                            <p className="text-xs text-amber-800 font-medium flex items-center gap-2">
                              <span className="text-lg">⚠️</span>
                              Debes seleccionar o crear un conjunto de opciones antes de guardar
                            </p>
                          </div>
                        )}
                        {newFieldOptionSetId && (
                          <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded">
                            <p className="text-xs text-green-800 font-medium flex items-center gap-2">
                              <span className="text-lg">✓</span>
                              Conjunto &quot;{optionSets.find(s => s.id === newFieldOptionSetId)?.name}&quot; seleccionado
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="bg-white rounded-lg p-4 border-2 border-purple-400 space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-gray-800">Crear nuevo conjunto de opciones</h4>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowQuickOptionSetCreator(false);
                              setQuickOptionSetName('');
                              setQuickOptionSetKey('');
                              setQuickOptions([{label: '', value: ''}]);
                            }}
                            className="text-gray-500"
                          >
                            ✕ Cancelar
                          </Button>
                        </div>

                        <div>
                          <Label className="text-xs">Nombre del conjunto *</Label>
                          <Input
                            value={quickOptionSetName}
                            onChange={(e) => {
                              setQuickOptionSetName(e.target.value);
                              // Auto-generate key from name
                              if (!quickOptionSetKey || quickOptionSetKey === quickOptionSetName.toLowerCase().replace(/[^a-z0-9]/g, '_')) {
                                setQuickOptionSetKey(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
                              }
                            }}
                            placeholder="ej: Tallas de camisetas"
                            className="mt-1"
                          />
                        </div>

                        <div>
                          <Label className="text-xs">Clave única *</Label>
                          <Input
                            value={quickOptionSetKey}
                            onChange={(e) => setQuickOptionSetKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                            placeholder="ej: tallas_camisetas"
                            className="mt-1 font-mono text-sm"
                          />
                        </div>

                        <div>
                          <Label className="text-xs mb-2 block">Opciones *</Label>
                          {quickOptions.map((opt, idx) => (
                            <div key={idx} className="flex gap-2 mb-2">
                              <Input
                                placeholder="Etiqueta (ej: Pequeña)"
                                value={opt.label}
                                onChange={(e) => {
                                  const newOpts = [...quickOptions];
                                  newOpts[idx].label = e.target.value;
                                  if (!newOpts[idx].value) {
                                    newOpts[idx].value = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_');
                                  }
                                  setQuickOptions(newOpts);
                                }}
                                className="flex-1"
                              />
                              <Input
                                placeholder="Valor (ej: s)"
                                value={opt.value}
                                onChange={(e) => {
                                  const newOpts = [...quickOptions];
                                  newOpts[idx].value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
                                  setQuickOptions(newOpts);
                                }}
                                className="flex-1 font-mono text-sm"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setQuickOptions(quickOptions.filter((_, i) => i !== idx))}
                                disabled={quickOptions.length === 1}
                              >
                                🗑️
                              </Button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setQuickOptions([...quickOptions, {label: '', value: ''}])}
                            className="w-full mt-1"
                          >
                            + Agregar opción
                          </Button>
                        </div>

                        <Button
                          type="button"
                          onClick={async () => {
                            if (!quickOptionSetName || !quickOptionSetKey || quickOptions.some(o => !o.label || !o.value)) {
                              toast({
                                variant: "destructive",
                                title: "Datos incompletos",
                                description: "Completa todos los campos antes de guardar"
                              });
                              return;
                            }

                            try {
                              // Create option set
                              const setRes = await fetch('/api/config/option-sets', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  name: quickOptionSetName,
                                  key: quickOptionSetKey
                                })
                              });
                              const setData = await setRes.json();
                              
                              if (setData.status !== 'success') throw new Error(setData.error);

                              // Create options
                              for (const opt of quickOptions) {
                                await fetch('/api/config/options', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    setId: setData.data.id,
                                    label: opt.label,
                                    value: opt.value,
                                    priceDelta: 0
                                  })
                                });
                              }

                              await loadData();
                              setNewFieldOptionSetId(setData.data.id);
                              setShowQuickOptionSetCreator(false);
                              setQuickOptionSetName('');
                              setQuickOptionSetKey('');
                              setQuickOptions([{label: '', value: ''}]);
                              
                              toast({
                                title: "✅ Conjunto creado",
                                description: `"${quickOptionSetName}" con ${quickOptions.length} opciones`
                              });
                            } catch (error) {
                              toast({
                                variant: "destructive",
                                title: "Error",
                                description: error instanceof Error ? error.message : "No se pudo crear el conjunto"
                              });
                            }
                          }}
                          className="w-full bg-purple-600 hover:bg-purple-700"
                        >
                          💾 Guardar conjunto y usar
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="required"
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <label className="ml-2 text-sm text-gray-700">Campo requerido</label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCustomFieldForm(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="bg-purple-600 hover:bg-purple-700">
                  Crear Campo
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Field Modal */}
      {editingField && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full my-8">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Edit className="w-5 h-5 text-blue-600" />
              Editar Campo: {editingField.label}
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target as HTMLFormElement);
                const payload = {
                  id: editingField.id,
                  key: editingField.key,
                  label: formData.get('label'),
                  type: formData.get('type'),
                  required: formData.get('required') === 'on',
                  order: Number(formData.get('order')),
                  multiSelect: editingField.multiSelect,
                  optionSetId: editingField.optionSetId,
                };

                try {
                  const res = await fetch('/api/config/fields', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  const json = await res.json();
                  
                  if (json.status === 'success') {
                    toast({
                      title: "✅ Campo actualizado",
                      description: "Los cambios se guardaron correctamente"
                    });
                    setEditingField(null);
                    await loadData();
                  } else {
                    throw new Error(json.error || 'Error al actualizar campo');
                  }
                } catch (error) {
                    toast({
                    variant: "destructive",
                    title: "Error",
                    description: error instanceof Error ? error.message : "No se pudo actualizar el campo"
                  });
                }
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Clave (No editable)
                  </label>
                  <input
                    type="text"
                    value={editingField.key}
                    disabled
                    className="w-full p-2 border border-gray-300 rounded-md bg-gray-100 text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Etiqueta *
                  </label>
                  <input
                    type="text"
                    name="label"
                    defaultValue={editingField.label}
                    required
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo *
                  </label>
                  <select
                    name="type"
                    defaultValue={editingField.type}
                    required
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="text">Texto</option>
                    <option value="number">Número</option>
                    <option value="email">Email</option>
                    <option value="tel">Teléfono</option>
                    <option value="textarea">Área de texto</option>
                    <option value="select">Selección</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Orden *
                  </label>
                  <input
                    type="number"
                    name="order"
                    defaultValue={editingField.order}
                    required
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="required"
                    defaultChecked={editingField.required}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label className="ml-2 text-sm text-gray-700">Campo requerido</label>
                </div>

                {/* Options Manager for Select Fields */}
                {editingField.type === 'select' && editingField.optionSetId && (
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <Database className="w-4 h-4" />
                        Opciones del Campo
                      </h4>
                      <Badge variant="outline">{fieldOptions.length} opciones</Badge>
                    </div>

                    {/* Existing Options List */}
                    <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                      {fieldOptions.map((option) => (
                        <div key={option.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                          {editingOptionId === option.id ? (
                            <>
                              <Input
                                defaultValue={option.label}
                                placeholder="Etiqueta"
                                className="flex-1 h-8 text-sm"
                                id={`opt-label-${option.id}`}
                              />
                              <Input
                                defaultValue={option.value}
                                placeholder="Valor"
                                className="flex-1 h-8 text-sm"
                                id={`opt-value-${option.id}`}
                              />
                              <Input
                                type="number"
                                defaultValue={option.priceDelta}
                                placeholder="₡"
                                className="w-20 h-8 text-sm"
                                id={`opt-price-${option.id}`}
                              />
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  const label = (document.getElementById(`opt-label-${option.id}`) as HTMLInputElement).value;
                                  const value = (document.getElementById(`opt-value-${option.id}`) as HTMLInputElement).value;
                                  const price = Number((document.getElementById(`opt-price-${option.id}`) as HTMLInputElement).value);
                                  handleUpdateOption(option.id, label, value, price);
                                }}
                                className="h-8 px-2 bg-green-600 hover:bg-green-700"
                              >
                                ✓
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingOptionId(null)}
                                className="h-8 px-2"
                              >
                                ✕
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-sm font-medium">{option.label}</span>
                              <Badge variant="outline" className="text-xs">{option.value}</Badge>
                              {option.priceDelta !== 0 && (
                                <Badge className="text-xs bg-green-100 text-green-700">
                                  {option.priceDelta > 0 ? '+' : ''}₡{option.priceDelta}
                                </Badge>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingOptionId(option.id)}
                                className="h-8 px-2 text-blue-600"
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteOption(option.id)}
                                className="h-8 px-2 text-red-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Add New Option Form */}
                    <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-md border border-blue-200">
                      <Input
                        value={newOptionLabel}
                        onChange={(e) => setNewOptionLabel(e.target.value)}
                        placeholder="Ej: Fedex, DHL, Color Azul..."
                        className="flex-1 h-8 text-sm"
                      />
                      <Input
                        type="number"
                        value={newOptionPrice}
                        onChange={(e) => setNewOptionPrice(Number(e.target.value))}
                        placeholder="₡ 0"
                        className="w-24 h-8 text-sm"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddOption}
                        disabled={!newOptionLabel}
                        className="h-8 px-3 bg-blue-600 hover:bg-blue-700"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Agregar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingField(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  Guardar Cambios
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

