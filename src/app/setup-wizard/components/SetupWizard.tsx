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
  Truck,
  Tags,
  CheckCircle2,
  ArrowRight,
  Home,
  AlertTriangle,
  X
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
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

import { WelcomeBusinessStep } from './steps/WelcomeBusinessStep';
import { OrderStatusStep } from './steps/OrderStatusStep';
import { ShippingCorreosStep } from './steps/ShippingCorreosStep';
import { FirstProductStep } from './steps/FirstProductStep';
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
    id: 'welcome-business',
    title: 'Tu Negocio',
    description: 'Cuéntanos sobre tu empresa para personalizar tu CRM',
    icon: Building2,
    component: WelcomeBusinessStep,
    optional: false,
  },
  {
    id: 'order-status',
    title: 'Estados de Pedidos',
    description: 'Define el flujo de trabajo para tus órdenes',
    icon: Tags,
    component: OrderStatusStep,
    optional: false,
  },
  {
    id: 'shipping-correos',
    title: 'Envíos',
    description: 'Configura Correos de Costa Rica u otro servicio',
    icon: Truck,
    component: ShippingCorreosStep,
    optional: true,
  },
  {
    id: 'first-product',
    title: 'Primer Producto',
    description: 'Agrega tu primer producto al inventario',
    icon: Package,
    component: FirstProductStep,
    optional: true,
  },
  {
    id: 'completion',
    title: '¡Listo!',
    description: 'Tu CRM está configurado y listo para usar',
    icon: CheckCircle2,
    component: CompletionStep,
    optional: false,
  },
];

const STORAGE_KEY = 'betsy-wizard-progress';

function loadProgress(): { stepIndex: number; completedSteps: string[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProgress(stepIndex: number, completedSteps: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex, completedSteps }));
  } catch { /* noop */ }
}

function clearProgress() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

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
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    const saved = loadProgress();
    if (saved) {
      setCurrentStepIndex(saved.stepIndex);
      setSteps(prev => prev.map(s => ({
        ...s,
        completed: saved.completedSteps.includes(s.id),
      })));
    }
  }, []);

  useEffect(() => {
    const completedSteps = steps.filter(s => s.completed).map(s => s.id);
    saveProgress(currentStepIndex, completedSteps);
  }, [currentStepIndex, steps]);

  const currentStep = steps[currentStepIndex];
  const progress = ((currentStepIndex + 1) / steps.length) * 100;
  const StepComponent = currentStep.component;

  const markCompleted = useCallback(() => {
    setSteps(prev => prev.map((step, idx) => 
      idx === currentStepIndex ? { ...step, completed: true } : step
    ));
    setCanProceed(true);
    setHasUnsavedChanges(false);
  }, [currentStepIndex]);

  const markUnsavedChanges = useCallback((hasChanges: boolean) => {
    setHasUnsavedChanges(hasChanges);
  }, []);

  const navigateTo = useCallback((index: number) => {
    setDirection(index > currentStepIndex ? 1 : -1);
    setCurrentStepIndex(index);
    setCanProceed(false);
    setHasUnsavedChanges(false);
  }, [currentStepIndex]);

  const handleNext = () => {
    if (hasUnsavedChanges) {
      setPendingNavigationIndex(currentStepIndex + 1);
      setShowNavigationDialog(true);
      return;
    }
    if (currentStepIndex < steps.length - 1) {
      navigateTo(currentStepIndex + 1);
    }
  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setPendingNavigationIndex(currentStepIndex - 1);
      setShowNavigationDialog(true);
      return;
    }
    if (currentStepIndex > 0) {
      navigateTo(currentStepIndex - 1);
    }
  };

  const confirmNavigation = () => {
    if (pendingNavigationIndex !== null) {
      navigateTo(pendingNavigationIndex);
    }
    setShowNavigationDialog(false);
    setPendingNavigationIndex(null);
  };

  const handleSkip = () => {
    if (currentStep.optional) handleNext();
  };

  const handleExit = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true);
      return;
    }
    confirmExit();
  };

  const confirmExit = () => {
    router.push('/dashboard');
    setShowExitDialog(false);
  };

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-background dark:via-blue-950/20 dark:to-indigo-950/20">
      {/* Header */}
      <div className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Configuración Inicial</h1>
                <p className="text-xs text-muted-foreground">
                  Paso {currentStepIndex + 1} de {steps.length} &mdash; {currentStep.title}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <Badge variant="destructive" className="animate-pulse text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Sin guardar
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={handleExit}>
                <Home className="h-4 w-4 mr-1" />
                Salir
              </Button>
            </div>
          </div>

          {/* Step indicators */}
          <div className="mt-3 flex items-center gap-1">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isCurrent = idx === currentStepIndex;
              const isDone = step.completed;
              return (
                <div key={step.id} className="flex items-center flex-1">
                  <button
                    onClick={() => {
                      if (isDone || idx < currentStepIndex) {
                        if (hasUnsavedChanges) {
                          setPendingNavigationIndex(idx);
                          setShowNavigationDialog(true);
                        } else {
                          navigateTo(idx);
                        }
                      }
                    }}
                    disabled={!isDone && idx > currentStepIndex}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                      isCurrent
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:ring-blue-800'
                        : isDone
                        ? 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50 cursor-pointer'
                        : 'text-muted-foreground cursor-default'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isCurrent ? 'bg-blue-600 text-white'
                      : isDone ? 'bg-green-600 text-white'
                      : 'bg-muted text-muted-foreground'
                    }`}>
                      {isDone ? <Check className="h-3 w-3" /> : <span className="text-[10px]">{idx + 1}</span>}
                    </div>
                    <span className="hidden sm:inline truncate">{step.title}</span>
                  </button>
                  {idx < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 rounded ${isDone ? 'bg-green-300 dark:bg-green-700' : 'bg-muted'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep.id}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            <Card className="shadow-xl border-0 overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-card to-blue-50/50 dark:to-blue-950/20 border-b border-border pb-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg">
                    {React.createElement(currentStep.icon, { className: 'h-6 w-6 text-white' })}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle className="text-2xl">{currentStep.title}</CardTitle>
                      {currentStep.optional && <Badge variant="secondary">Opcional</Badge>}
                      {currentStep.completed && (
                        <Badge className="bg-green-600">
                          <Check className="h-3 w-3 mr-1" />
                          Completado
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-base">{currentStep.description}</CardDescription>
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
              <div className="border-t border-border bg-muted/80 px-6 py-4 flex items-center justify-between">
                <Button variant="outline" onClick={handleBack} disabled={currentStepIndex === 0}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Anterior
                </Button>
                <div className="flex items-center gap-2">
                  {currentStep.optional && !currentStep.completed && (
                    <Button variant="ghost" onClick={handleSkip}>Omitir</Button>
                  )}
                  {currentStepIndex < steps.length - 1 ? (
                    <Button
                      onClick={handleNext}
                      disabled={!canProceed && !currentStep.optional && !currentStep.completed}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button onClick={handleExit} className="bg-green-600 hover:bg-green-700">
                      Ir al Dashboard
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Exit Dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ¿Salir sin guardar?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tienes cambios sin guardar. Si sales ahora, perderás estos cambios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel><X className="h-4 w-4 mr-1" />Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmExit} className="bg-red-600 hover:bg-red-700">
              <Home className="h-4 w-4 mr-1" />Salir sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Navigation Dialog */}
      <AlertDialog open={showNavigationDialog} onOpenChange={setShowNavigationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ¿Continuar sin guardar?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tienes cambios sin guardar en este paso. Si continúas, perderás estos cambios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel><X className="h-4 w-4 mr-1" />Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNavigation} className="bg-amber-600 hover:bg-amber-700">
              <ChevronRight className="h-4 w-4 mr-1" />Continuar sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
