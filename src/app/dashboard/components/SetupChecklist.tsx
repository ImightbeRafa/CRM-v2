'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Progress } from '@/app/components/ui/progress';
import {
  Building2,
  Tags,
  Package,
  CheckCircle2,
  Circle,
  ArrowRight,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
  PartyPopper,
} from 'lucide-react';

interface SetupStatusItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  href: string;
}

interface SetupStatusResponse {
  allCompleted: boolean;
  completedCount: number;
  totalCount: number;
  items: SetupStatusItem[];
  guide?: {
    enabled: boolean;
    progress: {
      status: 'in_progress' | 'dismissed' | 'completed';
      revision: number;
    } | null;
  };
}

const DISMISS_KEY = 'betsy-setup-checklist-dismissed';
const DISMISS_HASH_KEY = 'betsy-setup-checklist-dismiss-hash';

const ITEM_ICONS: Record<string, React.ComponentType<any>> = {
  'business-profile': Building2,
  'order-statuses': Tags,
  'inventory': Package,
};

const ITEM_COLORS: Record<string, string> = {
  'business-profile': 'from-blue-500 to-blue-600',
  'order-statuses': 'from-amber-500 to-orange-500',
  'inventory': 'from-rose-500 to-pink-600',
};

function computeIncompleteHash(items: SetupStatusItem[]): string {
  return items
    .filter((i) => !i.completed)
    .map((i) => i.id)
    .sort()
    .join(',');
}

export function SetupChecklist() {
  const router = useRouter();
  const [data, setData] = useState<SetupStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const hasAutoCompleted = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/setup-status');
      if (!res.ok) return;
      const json: SetupStatusResponse = await res.json();
      setData(json);

      if (!json.guide?.enabled && json.allCompleted && !hasAutoCompleted.current) {
        hasAutoCompleted.current = true;
        setShowCelebration(true);
        try {
          await fetch('/api/setup/wizard-complete', {
            method: 'POST',
            credentials: 'include',
          });
        } catch { /* best-effort */ }
        setTimeout(() => setShowCelebration(false), 4000);
      }

      if (json.guide?.enabled) {
        setIsDismissed(json.guide.progress?.status === 'dismissed' || json.guide.progress?.status === 'completed');
        return;
      }

      const currentHash = computeIncompleteHash(json.items);
      try {
        const dismissed = localStorage.getItem(DISMISS_KEY);
        const savedHash = localStorage.getItem(DISMISS_HASH_KEY);
        if (dismissed === 'true' && savedHash === currentHash) {
          setIsDismissed(true);
        } else if (dismissed === 'true' && savedHash !== currentHash) {
          localStorage.removeItem(DISMISS_KEY);
          localStorage.removeItem(DISMISS_HASH_KEY);
          setIsDismissed(false);
        }
      } catch { /* noop */ }
    } catch {
      /* network error — silently ignore, checklist just won't show */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleDismiss = async () => {
    setIsDismissed(true);
    if (data?.guide?.enabled && data.guide.progress) {
      const response = await fetch('/api/setup/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dismiss',
          expectedRevision: data.guide.progress.revision,
        }),
      });
      if (!response.ok) {
        setIsDismissed(false);
        await fetchStatus();
      }
      return;
    }
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
      if (data) {
        localStorage.setItem(DISMISS_HASH_KEY, computeIncompleteHash(data.items));
      }
    } catch { /* noop */ }
  };

  if (isLoading || !data) return null;
  if ((!data.guide?.enabled && data.allCompleted && !showCelebration) || data.guide?.progress?.status === 'completed') return null;
  if (isDismissed) return null;

  const progressPercent = (data.completedCount / data.totalCount) * 100;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="mb-6"
      >
        <Card className="border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/80 dark:from-blue-950/40 dark:via-card dark:to-indigo-950/40 shadow-lg overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-md flex-shrink-0">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base sm:text-lg font-bold text-foreground leading-snug">
                    {showCelebration ? '¡Configuración Completa!' : 'Configura tu Sistema'}
                  </CardTitle>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                    {showCelebration
                      ? 'Tu CRM está listo para recibir pedidos'
                      : `Completa estos pasos — ${data.completedCount}/${data.totalCount} listos`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  title={isCollapsed ? 'Expandir' : 'Colapsar'}
                  aria-label={isCollapsed ? 'Expandir' : 'Colapsar'}
                >
                  {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground"
                  onClick={handleDismiss}
                  title="Ocultar"
                  aria-label="Ocultar checklist"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3">
              <Progress value={progressPercent} className="h-2" />
            </div>
          </CardHeader>

          <AnimatePresence>
            {!isCollapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                <CardContent className="pt-0 pb-4">
                  {showCelebration ? (
                    <div className="flex flex-col items-center py-4 text-center">
                      <PartyPopper className="h-12 w-12 text-amber-500 mb-3" />
                      <p className="text-base font-semibold text-foreground">
                        ¡Felicidades! Todo está configurado.
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Ya puedes empezar a gestionar tus pedidos.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Checklist items */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {data.items.map((item) => {
                          const Icon = ITEM_ICONS[item.id] || Package;
                          const gradient = ITEM_COLORS[item.id] || 'from-gray-500 to-gray-600';

                          return (
                            <Link key={item.id} href={item.href} className="group block">
                              <div
                                className={`relative rounded-xl border p-3 transition-all duration-200 ${
                                  item.completed
                                    ? 'bg-green-50/80 dark:bg-green-950/20 border-green-200 dark:border-green-800'
                                    : 'bg-card border-border hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div
                                    className={`p-2 rounded-lg flex-shrink-0 ${
                                      item.completed
                                        ? 'bg-green-100 dark:bg-green-900/40'
                                        : `bg-gradient-to-br ${gradient} shadow-sm`
                                    }`}
                                  >
                                    {item.completed ? (
                                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                                    ) : (
                                      <Icon className="h-4 w-4 text-white" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p
                                        className={`text-sm font-semibold truncate ${
                                          item.completed
                                            ? 'text-green-700 dark:text-green-400'
                                            : 'text-foreground'
                                        }`}
                                      >
                                        {item.label}
                                      </p>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                      {item.completed ? 'Completado' : item.description}
                                    </p>
                                  </div>
                                  {!item.completed && (
                                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-blue-600 transition-colors flex-shrink-0 mt-0.5" />
                                  )}
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>

                      {/* Footer action */}
                      <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                          Toca cada sección para configurarla
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 w-full sm:w-auto min-h-[44px]"
                          onClick={() => router.push('/setup-wizard?returnTo=%2Fdashboard')}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Completar con Asistente
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
