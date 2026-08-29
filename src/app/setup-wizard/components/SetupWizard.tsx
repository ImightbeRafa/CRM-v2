'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  X,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  markCompleted: () => Promise<boolean>;
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
  const searchParams = useSearchParams();
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
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);
  const [serverProgressEnabled, setServerProgressEnabled] = useState(false);
  const [progressRevision, setProgressRevision] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [savingProgress, setSavingProgress] = useState(false);
  const [progressError, setProgressError] = useState('');
  const initialStepRef = useRef(searchParams?.get('step'));

  const returnTo = useMemo(() => {
    const value = searchParams?.get('returnTo') || '/dashboard';
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('://') || value.startsWith('/logistics')) {
      return '/dashboard';
    }
    const allowed = ['/dashboard', '/ventas', '/produccion', '/estadisticas', '/config', '/setup-wizard'];
    return allowed.some(prefix => value === prefix || value.startsWith(`${prefix}?`)) ? value : '/dashboard';
  }, [searchParams]);

  const applyServerProgress = useCallback((progress: any, explicitStep?: string | null) => {
    const completed = Array.isArray(progress?.completedSteps) ? progress.completedSteps : [];
    const skipped = Array.isArray(progress?.skippedSteps) ? progress.skippedSteps : [];
    const requested = explicitStep && WIZARD_STEPS.some(step => step.id === explicitStep)
      ? explicitStep
      : progress?.currentStep;
    const nextIndex = Math.max(0, WIZARD_STEPS.findIndex(step => step.id === requested));
    setCurrentStepIndex(nextIndex);
    setSteps(WIZARD_STEPS.map(step => ({ ...step, completed: completed.includes(step.id) })));
    setSkippedSteps(skipped);
    setProgressRevision(Number(progress?.revision || 0));
    setCanProceed(completed.includes(WIZARD_STEPS[nextIndex].id) || WIZARD_STEPS[nextIndex].optional);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/setup/progress', { credentials: 'include' });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (response.ok && payload.enabled && payload.progress) {
          setServerProgressEnabled(true);
          applyServerProgress(payload.progress, initialStepRef.current);
          clearProgress();
          return;
        }
      } catch { /* legacy fallback below */ }

      if (!active) return;
      const saved = loadProgress();
      if (saved) {
        setCurrentStepIndex(saved.stepIndex);
        setSteps(prev => prev.map(s => ({ ...s, completed: saved.completedSteps.includes(s.id) })));
      }
      const explicit = initialStepRef.current;
      const explicitIndex = WIZARD_STEPS.findIndex(step => step.id === explicit);
      if (explicitIndex >= 0) setCurrentStepIndex(explicitIndex);
    };
    void load().finally(() => { if (active) setLoadingProgress(false); });
    return () => { active = false; };
  }, [applyServerProgress]);

  useEffect(() => {
    if (loadingProgress || serverProgressEnabled) return;
    const completedSteps = steps.filter(s => s.completed).map(s => s.id);
    saveProgress(currentStepIndex, completedSteps);
  }, [currentStepIndex, steps, loadingProgress, serverProgressEnabled]);

  const currentStep = steps[currentStepIndex];
  const progress = ((currentStepIndex + 1) / steps.length) * 100;
  const StepComponent = currentStep.component;

  const persistProgress = useCallback(async (
    action: 'visit' | 'complete' | 'skip' | 'dismiss' | 'restart',
    step?: string,
  ) => {
    if (!serverProgressEnabled) return null;
    setSavingProgress(true);
    setProgressError('');
    try {
      const response = await fetch('/api/setup/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, step, expectedRevision: progressRevision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el progreso');
      applyServerProgress(
        payload.progress,
        action === 'visit' || action === 'complete' ? step || null : null,
      );
      return payload.progress;
    } catch (error) {
      setProgressError(error instanceof Error ? error.message : 'No se pudo guardar el progreso');
      return null;
    } finally {
      setSavingProgress(false);
    }
  }, [applyServerProgress, progressRevision, serverProgressEnabled]);

  const markCompleted = useCallback(async () => {
    const step = WIZARD_STEPS[currentStepIndex];
    if (steps[currentStepIndex]?.completed) {
      setCanProceed(true);
      setHasUnsavedChanges(false);
      return true;
    }
    const finish = async (): Promise<boolean> => {
      if (serverProgressEnabled && step.id === 'completion') {
        setSavingProgress(true);
        try {
          const response = await fetch('/api/setup/wizard-complete', { method: 'POST', credentials: 'include' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || 'No se pudo completar la guía');
          if (payload.setupProgress) applyServerProgress(payload.setupProgress, 'completion');
        } catch (error) {
          setProgressError(error instanceof Error ? error.message : 'No se pudo completar la guía');
          return false;
        } finally {
          setSavingProgress(false);
        }
      } else if (serverProgressEnabled) {
        const saved = await persistProgress('complete', step.id);
        if (!saved) return false;
      } else {
        setSteps(prev => prev.map((item, idx) => idx === currentStepIndex ? { ...item, completed: true } : item));
      }
      setCanProceed(true);
      setHasUnsavedChanges(false);
      return true;
    };
    return finish();
  }, [applyServerProgress, currentStepIndex, persistProgress, serverProgressEnabled, steps]);

  const markUnsavedChanges = useCallback((hasChanges: boolean) => {
    setHasUnsavedChanges(hasChanges);
  }, []);

  const navigateTo = useCallback(async (index: number) => {
    const target = WIZARD_STEPS[index];
    if (!target || savingProgress) return;
    if (serverProgressEnabled) {
      const saved = await persistProgress('visit', target.id);
      if (!saved) return;
    }
    setDirection(index > currentStepIndex ? 1 : -1);
    setCurrentStepIndex(index);
    setCanProceed(steps[index]?.completed || target.optional);
    setHasUnsavedChanges(false);
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('step', target.id);
    router.replace(`/setup-wizard?${params.toString()}`, { scroll: false });
  }, [currentStepIndex, persistProgress, router, savingProgress, searchParams, serverProgressEnabled, steps]);

  const handleNext = () => {
    if (hasUnsavedChanges) {
      setPendingNavigationIndex(currentStepIndex + 1);
      setShowNavigationDialog(true);
      return;
    }
    if (currentStepIndex < steps.length - 1) {
      void navigateTo(currentStepIndex + 1);
    }
  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setPendingNavigationIndex(currentStepIndex - 1);
      setShowNavigationDialog(true);
      return;
    }
    if (currentStepIndex > 0) {
      void navigateTo(currentStepIndex - 1);
    }
  };

  const confirmNavigation = () => {
    if (pendingNavigationIndex !== null) {
      void navigateTo(pendingNavigationIndex);
    }
    setShowNavigationDialog(false);
    setPendingNavigationIndex(null);
  };

  const handleSkip = async () => {
    if (!currentStep.optional || savingProgress) return;
    if (serverProgressEnabled) {
      const saved = await persistProgress('skip', currentStep.id);
      if (!saved) return;
      setSkippedSteps(saved.skippedSteps || []);
      const nextIndex = WIZARD_STEPS.findIndex(step => step.id === saved.currentStep);
      if (nextIndex >= 0) {
        setDirection(nextIndex > currentStepIndex ? 1 : -1);
        const params = new URLSearchParams(searchParams?.toString() || '');
        params.set('step', saved.currentStep);
        router.replace(`/setup-wizard?${params.toString()}`, { scroll: false });
      }
      return;
    }
    if (currentStepIndex < steps.length - 1) await navigateTo(currentStepIndex + 1);
  };

  const handleExit = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true);
      return;
    }
    confirmExit();
  };

  const confirmExit = async () => {
    if (serverProgressEnabled) await persistProgress('dismiss');
    router.push(returnTo);
    setShowExitDialog(false);
  };

  const handleRestart = async () => {
    if (!window.confirm('¿Reiniciar la guía? Tu configuración real no se eliminará.')) return;
    const saved = await persistProgress('restart');
    if (saved) {
      setSkippedSteps([]);
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('step', 'welcome-business');
      router.replace(`/setup-wizard?${params.toString()}`, { scroll: false });
    }
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

  if (loadingProgress) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <div className="rounded-2xl border border-border bg-card px-8 py-7 text-center shadow-lg">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-3 text-sm text-muted-foreground">Cargando tu guía de configuración…</p>
        </div>
      </div>
    );
  }

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
              {serverProgressEnabled && (
                <Button variant="ghost" size="sm" onClick={handleRestart} disabled={savingProgress}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Reiniciar guía</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleExit} disabled={savingProgress}>
                <Home className="h-4 w-4 mr-1" />
                Ahora no
              </Button>
            </div>
          </div>

          {/* Step indicators */}
          <div className="mt-3 flex items-center gap-1">
            {steps.map((step, idx) => {
              const Icon = step.icon;
              const isCurrent = idx === currentStepIndex;
              const isDone = step.completed;
              const isSkipped = skippedSteps.includes(step.id);
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
                        : isSkipped
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 cursor-pointer'
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
        {progressError && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {progressError}. Actualiza la página antes de continuar.
          </div>
        )}
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
                <Button variant="outline" onClick={handleBack} disabled={currentStepIndex === 0 || savingProgress}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Anterior
                </Button>
                <div className="flex items-center gap-2">
                  {currentStep.optional && !currentStep.completed && (
                    <Button variant="ghost" onClick={() => void handleSkip()} disabled={savingProgress}>Omitir</Button>
                  )}
                  {currentStepIndex < steps.length - 1 ? (
                    <Button
                      onClick={handleNext}
                      disabled={savingProgress || (!canProceed && !currentStep.optional && !currentStep.completed)}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button onClick={handleExit} disabled={savingProgress} className="bg-green-600 hover:bg-green-700">
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
