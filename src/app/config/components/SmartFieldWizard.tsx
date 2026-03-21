'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import {
  Palette,
  Ruler,
  Package,
  Tag,
  Truck,
  Building,
  MapPin,
  Phone,
  Mail,
  User,
  Calendar,
  DollarSign,
  Sparkles,
  ArrowRight,
  Check
} from 'lucide-react';

interface PresetField {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'email' | 'tel' | 'textarea';
  category: 'producto' | 'negocio' | 'envio';
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  required: boolean;
  options?: Array<{ label: string; value: string; priceDelta?: number }>;
}

const PRESET_FIELDS: PresetField[] = [
  // PRODUCTO FIELDS
  {
    id: 'color',
    key: 'color',
    label: 'Color',
    type: 'select',
    category: 'producto',
    description: 'Color del producto',
    icon: Palette,
    required: false,
    options: [
      { label: 'Rojo', value: 'rojo' },
      { label: 'Azul', value: 'azul' },
      { label: 'Verde', value: 'verde' },
      { label: 'Negro', value: 'negro' },
      { label: 'Blanco', value: 'blanco' },
    ]
  },
  {
    id: 'tamano',
    key: 'tamano',
    label: 'Tamaño',
    type: 'select',
    category: 'producto',
    description: 'Tamaño o medida del producto',
    icon: Ruler,
    required: false,
    options: [
      { label: 'XS', value: 'xs' },
      { label: 'S', value: 's' },
      { label: 'M', value: 'm' },
      { label: 'L', value: 'l' },
      { label: 'XL', value: 'xl' },
    ]
  },
  {
    id: 'material',
    key: 'material',
    label: 'Material',
    type: 'select',
    category: 'producto',
    description: 'Material de fabricación',
    icon: Package,
    required: false,
    options: [
      { label: 'Algodón', value: 'algodon' },
      { label: 'Poliéster', value: 'poliester' },
      { label: 'Cuero', value: 'cuero' },
      { label: 'Plástico', value: 'plastico' },
      { label: 'Metal', value: 'metal' },
    ]
  },
  {
    id: 'personalizacion',
    key: 'personalizacion',
    label: 'Personalización',
    type: 'textarea',
    category: 'producto',
    description: 'Detalles de personalización especial',
    icon: Tag,
    required: false,
  },
  {
    id: 'empaque',
    key: 'empaque',
    label: 'Tipo de Empaque',
    type: 'select',
    category: 'producto',
    description: 'Opciones de empaque',
    icon: Package,
    required: false,
    options: [
      { label: 'Estándar', value: 'estandar' },
      { label: 'Regalo', value: 'regalo', priceDelta: 500 },
      { label: 'Premium', value: 'premium', priceDelta: 1000 },
    ]
  },

  // NEGOCIO FIELDS
  {
    id: 'nombreNegocio',
    key: 'nombreNegocio',
    label: 'Nombre del Negocio',
    type: 'text',
    category: 'negocio',
    description: 'Razón social o nombre comercial',
    icon: Building,
    required: false,
  },
  {
    id: 'cedulaJuridica',
    key: 'cedulaJuridica',
    label: 'Cédula Jurídica',
    type: 'text',
    category: 'negocio',
    description: 'Número de identificación fiscal',
    icon: Building,
    required: false,
  },
  {
    id: 'telefono',
    key: 'telefono',
    label: 'Teléfono de Contacto',
    type: 'tel',
    category: 'negocio',
    description: 'Número telefónico principal',
    icon: Phone,
    required: false,
  },
  {
    id: 'emailContacto',
    key: 'emailContacto',
    label: 'Email de Contacto',
    type: 'email',
    category: 'negocio',
    description: 'Correo electrónico del cliente',
    icon: Mail,
    required: false,
  },
  {
    id: 'contactoPrincipal',
    key: 'contactoPrincipal',
    label: 'Contacto Principal',
    type: 'text',
    category: 'negocio',
    description: 'Nombre de la persona de contacto',
    icon: User,
    required: false,
  },

  // ENVIO FIELDS
  {
    id: 'provincia',
    key: 'provincia',
    label: 'Provincia',
    type: 'select',
    category: 'envio',
    description: 'Provincia de entrega',
    icon: MapPin,
    required: false,
    options: [
      { label: 'San José', value: 'san-jose' },
      { label: 'Alajuela', value: 'alajuela' },
      { label: 'Cartago', value: 'cartago' },
      { label: 'Heredia', value: 'heredia' },
      { label: 'Guanacaste', value: 'guanacaste' },
      { label: 'Puntarenas', value: 'puntarenas' },
      { label: 'Limón', value: 'limon' },
    ]
  },
  {
    id: 'canton',
    key: 'canton',
    label: 'Cantón',
    type: 'text',
    category: 'envio',
    description: 'Cantón de entrega',
    icon: MapPin,
    required: false,
  },
  {
    id: 'distrito',
    key: 'distrito',
    label: 'Distrito',
    type: 'text',
    category: 'envio',
    description: 'Distrito de entrega',
    icon: MapPin,
    required: false,
  },
  {
    id: 'direccionExacta',
    key: 'direccionExacta',
    label: 'Dirección Exacta',
    type: 'textarea',
    category: 'envio',
    description: 'Dirección completa de entrega',
    icon: MapPin,
    required: false,
  },
  {
    id: 'metodoEnvio',
    key: 'metodoEnvio',
    label: 'Método de Envío',
    type: 'select',
    category: 'envio',
    description: 'Transportista con costo incluido',
    icon: Truck,
    required: false,
    options: [
      { label: 'Correos de Costa Rica (₡2,000)', value: 'correos-cr', priceDelta: 2000 },
      { label: 'Mensajería Privada (₡2,500)', value: 'mensajeria', priceDelta: 2500 },
    ]
  },
  {
    id: 'fechaEntrega',
    key: 'fechaEntrega',
    label: 'Fecha de Entrega',
    type: 'text',
    category: 'envio',
    description: 'Fecha estimada de entrega',
    icon: Calendar,
    required: false,
  },
];

interface SmartFieldWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onFieldSelect: (field: PresetField) => void;
  onCustomField: () => void;
}

export function SmartFieldWizard({
  isOpen,
  onClose,
  onFieldSelect,
  onCustomField
}: SmartFieldWizardProps) {
  const [selectedCategory, setSelectedCategory] = useState<'producto' | 'negocio' | 'envio' | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  const filteredFields = selectedCategory
    ? PRESET_FIELDS.filter(f => f.category === selectedCategory)
    : [];

  const handleFieldToggle = (fieldId: string) => {
    const newSelected = new Set(selectedFields);
    if (newSelected.has(fieldId)) {
      newSelected.delete(fieldId);
    } else {
      newSelected.add(fieldId);
    }
    setSelectedFields(newSelected);
  };

  const handleConfirm = () => {
    // Create fields for all selected
    const fields = PRESET_FIELDS.filter(f => selectedFields.has(f.id));
    fields.forEach(field => onFieldSelect(field));
    
    setSelectedFields(new Set());
    setSelectedCategory(null);
    onClose();
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'producto': return Package;
      case 'negocio': return Building;
      case 'envio': return Truck;
      default: return Sparkles;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="w-6 h-6 text-purple-500" />
            Agregar Campos al Formulario
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Selecciona campos predefinidos o crea uno personalizado
          </p>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Step 1: Choose Category */}
          {!selectedCategory && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">¿Qué tipo de campos necesitas?</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card 
                  className="cursor-pointer hover:shadow-lg transition-all hover:scale-105 border-2 hover:border-purple-500"
                  onClick={() => setSelectedCategory('producto')}
                >
                  <CardContent className="p-6 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
                      <Package className="w-8 h-8 text-purple-600" />
                    </div>
                    <h4 className="font-bold text-lg mb-2">Campos de Producto</h4>
                    <p className="text-sm text-muted-foreground">
                      Color, tamaño, material, personalización, empaque
                    </p>
                    <Badge className="mt-3 bg-purple-100 text-purple-700">
                      {PRESET_FIELDS.filter(f => f.category === 'producto').length} opciones
                    </Badge>
                  </CardContent>
                </Card>

                <Card 
                  className="cursor-pointer hover:shadow-lg transition-all hover:scale-105 border-2 hover:border-blue-500"
                  onClick={() => setSelectedCategory('negocio')}
                >
                  <CardContent className="p-6 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                      <Building className="w-8 h-8 text-blue-600" />
                    </div>
                    <h4 className="font-bold text-lg mb-2">Campos de Negocio</h4>
                    <p className="text-sm text-muted-foreground">
                      Razón social, cédula, contactos, información fiscal
                    </p>
                    <Badge className="mt-3 bg-blue-100 text-blue-700">
                      {PRESET_FIELDS.filter(f => f.category === 'negocio').length} opciones
                    </Badge>
                  </CardContent>
                </Card>

                <Card 
                  className="cursor-pointer hover:shadow-lg transition-all hover:scale-105 border-2 hover:border-green-500"
                  onClick={() => setSelectedCategory('envio')}
                >
                  <CardContent className="p-6 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                      <Truck className="w-8 h-8 text-green-600" />
                    </div>
                    <h4 className="font-bold text-lg mb-2">Campos de Envío</h4>
                    <p className="text-sm text-muted-foreground">
                      Direcciones, métodos de envío, fechas de entrega
                    </p>
                    <Badge className="mt-3 bg-green-100 text-green-700">
                      {PRESET_FIELDS.filter(f => f.category === 'envio').length} opciones
                    </Badge>
                  </CardContent>
                </Card>
              </div>

              <div className="border-t pt-4">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => {
                    onCustomField();
                    onClose();
                  }}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  O crea un campo personalizado
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Select Fields */}
          {selectedCategory && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setSelectedCategory(null);
                      setSelectedFields(new Set());
                    }}
                  >
                    ← Volver
                  </Button>
                  <h3 className="text-lg font-semibold text-foreground">
                    Selecciona los campos que necesitas
                  </h3>
                </div>
                <Badge variant="secondary">
                  {selectedFields.size} seleccionados
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredFields.map((field) => {
                  const Icon = field.icon;
                  const isSelected = selectedFields.has(field.id);
                  
                  return (
                    <Card 
                      key={field.id}
                      className={`cursor-pointer transition-all ${
                        isSelected 
                          ? 'border-2 border-purple-500 bg-purple-50' 
                          : 'hover:shadow-md hover:border-border'
                      }`}
                      onClick={() => handleFieldToggle(field.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg ${
                            isSelected ? 'bg-purple-200' : 'bg-muted'
                          }`}>
                            <Icon className={`w-5 h-5 ${
                              isSelected ? 'text-purple-600' : 'text-muted-foreground'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="font-semibold text-foreground">{field.label}</h4>
                              {isSelected && (
                                <Check className="w-5 h-5 text-purple-600" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{field.description}</p>
                            <div className="flex items-center gap-2 mt-2">
                              <Badge variant="outline" className="text-xs">
                                {field.type}
                              </Badge>
                              {field.required && (
                                <Badge variant="destructive" className="text-xs">
                                  Requerido
                                </Badge>
                              )}
                              {field.options && (
                                <Badge variant="secondary" className="text-xs">
                                  {field.options.length} opciones
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-4 border-t">
                <Button 
                  variant="outline"
                  onClick={() => {
                    onCustomField();
                    onClose();
                  }}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Crear campo personalizado
                </Button>
                <div className="flex gap-2">
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setSelectedFields(new Set());
                      setSelectedCategory(null);
                      onClose();
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button 
                    onClick={handleConfirm}
                    disabled={selectedFields.size === 0}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    Agregar {selectedFields.size} {selectedFields.size === 1 ? 'campo' : 'campos'}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

