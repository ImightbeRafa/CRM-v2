'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { X, CreditCard, AlertCircle, Clock } from 'lucide-react';

interface BillingInfo {
  name: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface TrialStatus {
  isInTrial: boolean;
  trialExpired: boolean;
  daysRemaining: number;
  currentPlan: string;
}

export default function SubscriptionBanner() {
  const { status } = useSession();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only load if authenticated
    if (status !== 'authenticated') {
      return;
    }

    // Load billing info with better error handling
    fetch('/api/billing/current')
      .then(r => {
        if (!r.ok) {
          console.warn('Billing API not available:', r.status);
          return null;
        }
        return r.json();
      })
      .then(j => {
        if (j && j.status === 'success' && j.data) setBilling(j.data);
      })
      .catch(err => {
        console.warn('Failed to load billing info:', err);
      });

    // Load trial status with better error handling
    fetch('/api/billing/trial-status')
      .then(r => {
        if (!r.ok) {
          console.warn('Trial status API not available:', r.status);
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (data && (data.isInTrial || data.trialExpired)) setTrial(data);
      })
      .catch(err => {
        console.warn('Failed to load trial status:', err);
      });
  }, [status]);

  if (dismissed) return null;

  // Priority 1: Show trial expired banner (most urgent)
  if (trial?.trialExpired) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white border-b px-4 py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-sm">Tu prueba gratuita ha expirado</p>
              <p className="text-xs opacity-90">Actualiza tu plan para seguir usando todas las funciones</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/config?tab=billing"
              className="px-3 py-1.5 bg-white text-red-600 rounded shadow-sm text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Activar Pro — $20/mes
            </a>
            <button
              onClick={() => setDismissed(true)}
              className="p-1 rounded hover:bg-white hover:bg-opacity-20 transition-colors"
              title="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Priority 2: Show trial warning in last 3 days
  if (trial?.isInTrial && trial.daysRemaining <= 3) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-yellow-900 border-b px-4 py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <Clock className="h-5 w-5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-sm">
                {trial.daysRemaining === 1 
                  ? '¡Último día de prueba gratuita!' 
                  : `${trial.daysRemaining} días restantes de prueba`
                }
              </p>
              <p className="text-xs opacity-90">Actualiza ahora para continuar sin interrupciones</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/config?tab=billing"
              className="px-3 py-1.5 bg-yellow-900 text-white rounded shadow-sm text-sm font-medium hover:bg-yellow-800 transition-colors"
            >
              Activar Pro — $20/mes
            </a>
            <button
              onClick={() => setDismissed(true)}
              className="p-1 rounded hover:bg-white hover:bg-opacity-20 transition-colors"
              title="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Priority 3: Show billing issues
  if (!billing) return null;
  
  const needsAction = ['past_due', 'canceled', 'pending', 'incomplete'].includes(billing.status);
  if (!needsAction) return null;

  const messages: Record<string, { title: string; desc: string; color: string }> = {
    past_due: {
      title: 'Pago Pendiente',
      desc: 'Tu último pago falló. Por favor, actualiza tu método de pago para evitar la interrupción del servicio.',
      color: 'bg-red-50 border-red-200 text-red-800',
    },
    canceled: {
      title: 'Suscripción Cancelada',
      desc: 'Tu suscripción fue cancelada. Renueva para continuar usando todas las funcionalidades.',
      color: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    },
    pending: {
      title: 'Pago Pendiente',
      desc: 'Completa tu pago para activar tu plan y desbloquear todas las funcionalidades.',
      color: 'bg-blue-50 border-blue-200 text-blue-800',
    },
    incomplete: {
      title: 'Configuración Incompleta',
      desc: 'Finaliza la configuración de tu suscripción para acceder a todas las funcionalidades.',
      color: 'bg-orange-50 border-orange-200 text-orange-800',
    },
  };

  const msg = messages[billing.status] || messages.pending;

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 ${msg.color} border-b px-4 py-3 shadow-md`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm">{msg.title}</p>
            <p className="text-xs">{msg.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/config?tab=billing"
            className="px-3 py-1.5 bg-white rounded shadow-sm text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            <CreditCard className="h-4 w-4" />
            Renovar Ahora
          </a>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-white hover:bg-opacity-50 transition-colors"
            title="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

