'use client'

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { 
  CheckCircle, 
  ArrowRight, 
  Zap, 
  Settings, 
  Users, 
  Database,
  Star,
  Palette,
  Ruler,
  Package
} from 'lucide-react';

interface QuickSetupStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  fields: Array<{
    key: string;
    label: string;
    description: string;
    icon: React.ComponentType<any>;
    recommended: boolean;
  }>;
}

const QUICK_SETUP_STEPS: QuickSetupStep[] = [
  {
    id: 'basic',
    title: 'Campos Básicos',
    description: 'Los campos más comunes que necesitas para tus productos',
    icon: Package,
    fields: [
      {
        key: 'color',
        label: 'Color',
        description: 'Color del producto',
        icon: Palette,
        recommended: true
      },
      {
        key: 'tamano',
        label: 'Tamaño',
        description: 'Tamaño del producto',
        icon: Ruler,
        recommended: true
      },
      {
        key: 'material',
        label: 'Material',
        description: 'Material del producto',
        icon: Package,
        recommended: false
      }
    ]
  },
  {
    id: 'details',
    title: 'Detalles del Producto',
    description: 'Información adicional para describir mejor tus productos',
    icon: Settings,
    fields: [
      {
        key: 'marca',
        label: 'Marca',
        description: 'Marca del producto',
        icon: Star,
        recommended: false
      },
      {
        key: 'peso',
        label: 'Peso',
        description: 'Peso del producto',
        icon: Package,
        recommended: false
      },
      {
        key: 'garantia',
        label: 'Garantía',
        description: 'Período de garantía',
        icon: CheckCircle,
        recommended: false
      }
    ]
  }
];

export function QuickSetupWizard({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [isSettingUp, setIsSettingUp] = useState(false);

  const currentStepData = QUICK_SETUP_STEPS[currentStep];
  const isLastStep = currentStep === QUICK_SETUP_STEPS.length - 1;

  const toggleField = (fieldKey: string) => {
    setSelectedFields(prev => 
      prev.includes(fieldKey) 
        ? prev.filter(key => key !== fieldKey)
        : [...prev, fieldKey]
    );
  };

  const nextStep = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  };

  const handleComplete = async () => {
    setIsSettingUp(true);
    try {
      // Create the selected fields
      for (const fieldKey of selectedFields) {
        const field = QUICK_SETUP_STEPS.flatMap(step => step.fields).find(f => f.key === fieldKey);
        if (field) {
          await createField(field);
        }
      }
      
      onComplete();
    } catch (error) {
      console.error('Error setting up fields:', error);
    } finally {
      setIsSettingUp(false);
    }
  };

  const createField = async (field: any) => {
    const response = await fetch('/api/config/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: field.key,
        label: field.label,
        type: 'text',
        required: false,
        order: 0
      })
    });

    if (response.ok && field.key === 'color') {
      // Create color options
      await createColorOptions();
    } else if (response.ok && field.key === 'tamano') {
      // Create size options
      await createSizeOptions();
    }
  };

  const createColorOptions = async () => {
    const colors = ['Rojo', 'Azul', 'Verde', 'Negro', 'Blanco', 'Amarillo', 'Rosa', 'Morado'];
    
    // Create option set
    const optionSetResponse = await fetch('/api/config/option-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Colores',
        key: 'color',
        description: 'Colores disponibles para productos'
      })
    });

    if (optionSetResponse.ok) {
      const optionSetData = await optionSetResponse.json();
      
      // Create color options
      for (const color of colors) {
        await fetch('/api/config/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            optionSetId: optionSetData.data.id,
            label: color,
            value: color.toLowerCase(),
            priceDelta: 0
          })
        });
      }
    }
  };

  const createSizeOptions = async () => {
    const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Único'];
    
    // Create option set
    const optionSetResponse = await fetch('/api/config/option-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tamaños',
        key: 'tamano',
        description: 'Tamaños disponibles para productos'
      })
    });

    if (optionSetResponse.ok) {
      const optionSetData = await optionSetResponse.json();
      
      // Create size options
      for (const size of sizes) {
        await fetch('/api/config/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            optionSetId: optionSetData.data.id,
            label: size,
            value: size.toLowerCase(),
            priceDelta: 0
          })
        });
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-card bg-opacity-20 rounded-xl">
              <Zap className="w-8 h-8" />
            </div>
            <div>
              <CardTitle className="text-2xl">Configuración Rápida</CardTitle>
              <p className="text-blue-100 mt-1">
                Te ayudamos a configurar los campos más comunes para tus productos
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">
                Paso {currentStep + 1} de {QUICK_SETUP_STEPS.length}
              </span>
              <span className="text-sm text-muted-foreground">
                {Math.round(((currentStep + 1) / QUICK_SETUP_STEPS.length) * 100)}% completado
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${((currentStep + 1) / QUICK_SETUP_STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Current Step */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <currentStepData.icon className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground">{currentStepData.title}</h3>
                <p className="text-muted-foreground">{currentStepData.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentStepData.fields.map(field => {
                const Icon = field.icon;
                const isSelected = selectedFields.includes(field.key);
                
                return (
                  <div
                    key={field.key}
                    onClick={() => toggleField(field.key)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      isSelected 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-border bg-card hover:border-border'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        isSelected ? 'bg-blue-100' : 'bg-muted'
                      }`}>
                        <Icon className={`w-5 h-5 ${
                          isSelected ? 'text-blue-600' : 'text-muted-foreground'
                        }`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-foreground">{field.label}</h4>
                          {field.recommended && (
                            <Badge className="bg-green-100 text-green-800 text-xs">
                              Recomendado
                            </Badge>
                          )}
                          {isSelected && (
                            <CheckCircle className="w-4 h-4 text-blue-600" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{field.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button
              onClick={prevStep}
              disabled={currentStep === 0}
              variant="outline"
              className="flex items-center gap-2"
            >
              Anterior
            </Button>

            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {selectedFields.length} campos seleccionados
              </span>
              <Button
                onClick={nextStep}
                disabled={isSettingUp}
                className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white flex items-center gap-2"
              >
                {isSettingUp ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Configurando...
                  </>
                ) : isLastStep ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Completar Configuración
                  </>
                ) : (
                  <>
                    Siguiente
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
