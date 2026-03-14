'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import {
  CheckCircle2,
  ShoppingCart,
  Users,
  BarChart3,
  BookOpen,
  ArrowRight,
  Sparkles,
  Loader2,
  PartyPopper,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { WizardStepProps } from '../SetupWizard';

const NEXT_STEPS = [
  {
    icon: ShoppingCart,
    title: 'Crear tu primer pedido',
    description: 'Registra una orden en el módulo de Ventas',
    href: '/ventas',
    color: 'from-blue-500 to-blue-600',
  },
  {
    icon: Users,
    title: 'Invitar a tu equipo',
    description: 'Agrega vendedores o colaboradores',
    href: '/config?tab=users',
    color: 'from-purple-500 to-purple-600',
  },
  {
    icon: BarChart3,
    title: 'Ver estadísticas',
    description: 'Explora los reportes y métricas',
    href: '/estadisticas',
    color: 'from-green-500 to-green-600',
  },
  {
    icon: BookOpen,
    title: 'Leer la documentación',
    description: 'Guías detalladas de cada función',
    href: '/help',
    color: 'from-amber-500 to-orange-500',
  },
];

export function CompletionStep({ markCompleted }: WizardStepProps) {
  const router = useRouter();
  const [completing, setCompleting] = useState(true);

  useEffect(() => {
    completeWizard();
  }, []);

  const completeWizard = async () => {
    try {
      await fetch('/api/setup/wizard-complete', {
        method: 'POST',
        credentials: 'include',
      });
      markCompleted();
      try { localStorage.removeItem('betsy-wizard-progress'); } catch { /* noop */ }
    } catch { /* still mark completed in UI */ markCompleted(); }
    finally { setCompleting(false); }
  };

  if (completing) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Success banner */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="text-center py-6"
      >
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 mb-4 shadow-lg">
          <PartyPopper className="h-10 w-10 text-white" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">¡Tu CRM está listo!</h2>
        <p className="text-gray-600 text-lg max-w-md mx-auto">
          Has completado la configuración inicial. Aquí tienes algunas ideas para empezar:
        </p>
      </motion.div>

      {/* Next steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {NEXT_STEPS.map((step, idx) => (
          <motion.div
            key={step.href}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * (idx + 1) }}
          >
            <Card
              className="p-4 hover:shadow-lg transition-shadow cursor-pointer group border-2 hover:border-blue-200"
              onClick={() => router.push(step.href)}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${step.color} shadow-md`}>
                  <step.icon className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                    {step.title}
                  </h3>
                  <p className="text-sm text-gray-500">{step.description}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-blue-500 transition-colors mt-1" />
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-center pt-2"
      >
        <Button
          size="lg"
          onClick={() => router.push('/dashboard')}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 h-12 px-8 text-base"
        >
          <Sparkles className="h-5 w-5 mr-2" />
          Ir al Dashboard
        </Button>
      </motion.div>
    </div>
  );
}
