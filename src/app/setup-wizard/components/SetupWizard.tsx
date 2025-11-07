'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Progress } from '@/app/components/ui/progress';
import { 
  Check, 
  ChevronRight, 
  ChevronLeft,
  Sparkles,
  Building2,
  Package,
  Users,
  Truck,
  Settings,
  LayoutList,
  Tags,
  ShoppingCart,
  CheckCircle2,
  ArrowRight,
  Home,
  Info,
  AlertTriangle,
  Save,
  X
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/app/components/ui/alert-dialog';

// Import step components
import { WelcomeStep } from './steps/WelcomeStep';
import { BusinessInfoStep } from './steps/BusinessInfoStep';
import { CustomFieldsStep } from './steps/CustomFieldsStep';
import { InventoryStep } from './steps/InventoryStep';
import { FrequentClientsStep } from './steps/FrequentClientsStep';
import { FrequentProductsStep } from './steps/FrequentProductsStep';
import { OrderStatusStep } from './steps/OrderStatusStep';
import { ShippingStep } from './steps/ShippingStep';
import { SellersStep } from './steps/SellersStep';
import { CompletionStep } from './steps/CompletionStep';

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  component: React.ComponentType<WizardStepProps>;
  optional: boolean;
  completed: boolean;
}

export interface WizardStepProps {
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
  markCompleted: () => void;
  markUnsavedChanges: (hasChanges: boolean) => void;
  isFirst: boolean;
  isLast: boolean;
}

const WIZARD_STEPS: Omit<WizardStep, 'completed'>[] = [
  {
    id: 'welcome',
    title: 'Bienvenido',
    description: 'Configuración inicial de tu CRM',
    icon: Sparkles,
    component: WelcomeStep,
    optional: false,
  },
  {
    id: 'business-info',
    title: 'Información del Negocio',
    description: 'Campos personalizados de tu empresa',
    icon: Building2,
    component: BusinessInfoStep,
    optional: true,
  },
  {
    id: 'custom-fields',
    title: 'Campos Personalizados',
    description: 'Campos adicionales para tus productos',
    icon: LayoutList,
    component: CustomFieldsStep,
    optional: true,
  },
  {
    id: 'order-status',
    title: 'Estados de Pedidos',
    description: 'Configura los estados del flujo de trabajo',
    icon: Tags,
    component: OrderStatusStep,
    optional: false,
  },
  {
    id: 'inventory',
    title: 'Inventario',
    description: 'Productos y stock disponible',
    icon: Package,
    component: InventoryStep,
    optional: true,
  },
  {
    id: 'frequent-clients',
    title: 'Clientes Frecuentes',
    description: 'Lista de clientes habituales',
    icon: Users,
    component: FrequentClientsStep,
    optional: true,
  },
  {
    id: 'frequent-products',
    title: 'Productos Frecuentes',
    description: 'Catálogo de productos comunes',
    icon: ShoppingCart,
    component: FrequentProductsStep,
    optional: true,
  },
  {
    id: 'sellers',
    title: 'Vendedores',
    description: 'Equipo de ventas',
    icon: Users,
    component: SellersStep,
    optional: true,
  },
  {
    id: 'shipping',
    title: 'Configuración de Envíos',
    description: 'Métodos de envío y mensajería',
    icon: Truck,
    component: ShippingStep,
    optional: true,
  },
  {
    id: 'completion',
    title: '¡Listo!',
    description: 'Tu CRM está configurado',
    icon: CheckCircle2,
    component: CompletionStep,
    optional: false,
  },
];

export function SetupWizard() {
  const router = useRouter();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [steps, setSteps] = useState<WizardStep[]>(
    WIZARD_STEPS.map(step => ({ ...step, completed: false }))
  );
  const [canProceed, setCanProceed] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [showNavigationDialog, setShowNavigationDialog] = useState(false);
  const [pendingNavigationIndex, setPendingNavigationIndex] = useState<number | null>(null);

  const currentStep = steps[currentStepIndex];
  const progress = ((currentStepIndex + 1) / steps.length) * 100;
  const StepComponent = currentStep.component;

  const markCompleted = useCallback(() => {
    setSteps(prev => prev.map((step, idx) => 
      idx === currentStepIndex ? { ...step, completed: true } : step
    ));
    setCanProceed(true);
    setHasUnsavedChanges(false); // Mark as saved when completed
  }, [currentStepIndex]);

  const markUnsavedChanges = useCallback((hasChanges: boolean) => {
    setHasUnsavedChanges(hasChanges);
  }, []);

  const handleNext = () => {
    if (hasUnsavedChanges) {
      setPendingNavigationIndex(currentStepIndex + 1);
      setShowNavigationDialog(true);
      return;
    }
    
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
      setCanProceed(false);
      setHasUnsavedChanges(false);
    }
  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setPendingNavigationIndex(currentStepIndex - 1);
      setShowNavigationDialog(true);
      return;
    }
    
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
      setCanProceed(true); // Can always proceed back
      setHasUnsavedChanges(false);
    }
  };

  const confirmNavigation = () => {
    if (pendingNavigationIndex !== null) {
      setCurrentStepIndex(pendingNavigationIndex);
      setHasUnsavedChanges(false);
      setCanProceed(pendingNavigationIndex < currentStepIndex); // Can proceed if going back
    }
    setShowNavigationDialog(false);
    setPendingNavigationIndex(null);
  };

  const cancelNavigation = () => {
    setShowNavigationDialog(false);
    setPendingNavigationIndex(null);
  };

  const handleSkip = () => {
    if (currentStep.optional) {
      handleNext();
    }
  };

  const handleExit = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true);
      return;
    }
    confirmExit();
  };

  const confirmExit = () => {
    // Navigate to dashboard - users can exit and come back later
    router.push('/dashboard');
    setShowExitDialog(false);
  };

  const cancelExit = () => {
    setShowExitDialog(false);
  };

  // Warn before closing/refreshing page if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const completedSteps = steps.filter(s => s.completed).length;
  const totalSteps = steps.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Sparkles className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Asistente de Configuración</h1>
                <p className="text-sm text-gray-600">
                  Paso {currentStepIndex + 1} de {totalSteps}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <Badge variant="destructive" className="animate-pulse">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Cambios sin guardar
                </Badge>
              )}
              <Button variant="ghost" onClick={handleExit}>
                <Home className="h-4 w-4 mr-2" />
                {hasUnsavedChanges ? 'Salir (sin guardar)' : 'Salir'}
              </Button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Progreso General
              </span>
              <span className="text-sm font-medium text-blue-600">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-12 gap-6">
          {/* Sidebar - Steps List */}
          <div className="col-span-12 lg:col-span-3">
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle className="text-sm">Pasos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {steps.map((step, idx) => {
                  const Icon = step.icon;
                  const isCurrent = idx === currentStepIndex;
                  const isPast = idx < currentStepIndex;
                  
                  return (
                    <div
                      key={step.id}
                      className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                        isCurrent 
                          ? 'bg-blue-100 border border-blue-200' 
                          : isPast 
                          ? 'bg-green-50' 
                          : 'bg-gray-50'
                      }`}
                    >
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        isCurrent 
                          ? 'bg-blue-600 text-white' 
                          : step.completed 
                          ? 'bg-green-600 text-white' 
                          : 'bg-gray-200 text-gray-500'
                      }`}>
                        {step.completed ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${
                          isCurrent ? 'text-blue-900' : step.completed ? 'text-green-900' : 'text-gray-600'
                        }`}>
                          {step.title}
                        </p>
                        {step.optional && (
                          <Badge variant="outline" className="text-xs mt-0.5">
                            Opcional
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Help Card */}
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Ayuda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-600">
                  Este asistente te guiará paso a paso en la configuración de tu CRM. 
                  Puedes omitir pasos opcionales y volver más tarde.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Main Step Content */}
          <div className="col-span-12 lg:col-span-9">
            <Card className="shadow-lg">
              <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-white rounded-lg shadow-sm">
                    {React.createElement(currentStep.icon, { className: 'h-6 w-6 text-blue-600' })}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle className="text-2xl">{currentStep.title}</CardTitle>
                      {currentStep.optional && (
                        <Badge variant="secondary">Opcional</Badge>
                      )}
                      {currentStep.completed && (
                        <Badge className="bg-green-600">
                          <Check className="h-3 w-3 mr-1" />
                          Completado
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-base">
                      {currentStep.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                <StepComponent
                  onNext={handleNext}
                  onSkip={handleSkip}
                  onBack={handleBack}
                  markCompleted={markCompleted}
                  markUnsavedChanges={markUnsavedChanges}
                  isFirst={currentStepIndex === 0}
                  isLast={currentStepIndex === steps.length - 1}
                />
              </CardContent>

              {/* Navigation Footer */}
              <div className="border-t bg-gray-50 px-6 py-4 flex items-center justify-between">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={currentStepIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Anterior
                </Button>

                <div className="flex items-center gap-2">
                  {currentStep.optional && !currentStep.completed && (
                    <Button
                      variant="ghost"
                      onClick={handleSkip}
                    >
                      Omitir
                    </Button>
                  )}
                  
                  {currentStepIndex < steps.length - 1 ? (
                    <Button
                      onClick={handleNext}
                      disabled={!canProceed && !currentStep.optional && !currentStep.completed}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleExit}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      Ir al Dashboard
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Exit Confirmation Dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              ¿Salir sin guardar?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tienes cambios sin guardar en este paso. Si sales ahora, perderás estos cambios.
              ¿Estás seguro de que deseas salir?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelExit}>
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmExit} className="bg-red-600 hover:bg-red-700">
              <Home className="h-4 w-4 mr-2" />
              Salir sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Navigation Confirmation Dialog */}
      <AlertDialog open={showNavigationDialog} onOpenChange={setShowNavigationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              ¿Continuar sin guardar?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tienes cambios sin guardar en este paso. Si continúas, perderás estos cambios.
              ¿Deseas continuar de todas formas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelNavigation}>
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmNavigation} className="bg-amber-600 hover:bg-amber-700">
              <ChevronRight className="h-4 w-4 mr-2" />
              Continuar sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

