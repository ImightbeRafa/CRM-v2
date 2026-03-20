'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { X, CreditCard, AlertCircle, Clock } from 'lucide-react';

const PUBLIC_PATHS = [
  '/home', '/landing', '/auth', '/privacy', '/terms',
  '/data-deletion', '/docs', '/help', '/unauthorized',
];

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
  const pathname = usePathname();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const isPublicRoute = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));

  useEffect(() => {
    if (status !== 'authenticated' || isPublicRoute) {
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
  }, [status, isPublicRoute]);

  if (status !== 'authenticated' || isPublicRoute) return null;
  if (dismissed) return null;

  // Priority 1: Show trial expired banner (most urgent)
  if (trial?.trialExpired) {
    return (
      <div className="sticky top-0 z-50 bg-red-600 text-white border-b px-3 py-2 md:px-4 md:py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
            <AlertCircle className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
            <p className="font-semibold text-xs md:text-sm truncate">Prueba expirada</p>
            <p className="hidden md:block text-xs opacity-90">— Actualiza tu plan para seguir usando todas las funciones</p>
          </div>
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            <a
              href="/config?tab=billing"
              className="px-2.5 py-1 md:px-3 md:py-1.5 bg-white text-red-600 rounded shadow-sm text-xs md:text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Activar Pro
            </a>
            <button
              onClick={() => setDismissed(true)}
              className="p-2 rounded hover:bg-white hover:bg-opacity-20 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
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
      <div className="sticky top-0 z-50 bg-yellow-500 text-yellow-900 border-b px-3 py-2 md:px-4 md:py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 md:gap-4">
          <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
            <Clock className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
            <p className="font-semibold text-xs md:text-sm truncate">
              {trial.daysRemaining === 1 
                ? '¡Último día de prueba!' 
                : `${trial.daysRemaining} días de prueba`
              }
            </p>
            <p className="hidden md:block text-xs opacity-90">— Actualiza ahora para continuar sin interrupciones</p>
          </div>
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            <a
              href="/config?tab=billing"
              className="px-2.5 py-1 md:px-3 md:py-1.5 bg-yellow-900 text-white rounded shadow-sm text-xs md:text-sm font-medium hover:bg-yellow-800 transition-colors whitespace-nowrap"
            >
              Activar Pro
            </a>
            <button
              onClick={() => setDismissed(true)}
              className="p-2 rounded hover:bg-white hover:bg-opacity-20 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
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
    <div className={`sticky top-0 z-50 ${msg.color} border-b px-3 py-2 md:px-4 md:py-3 shadow-md`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
          <AlertCircle className="h-4 w-4 md:h-5 md:w-5 flex-shrink-0" />
          <p className="font-semibold text-xs md:text-sm truncate">{msg.title}</p>
          <p className="hidden md:block text-xs">{msg.desc}</p>
        </div>
        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          <a
            href="/config?tab=billing"
            className="px-2.5 py-1 md:px-3 md:py-1.5 bg-white rounded shadow-sm text-xs md:text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-1 whitespace-nowrap"
          >
            <CreditCard className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <span className="hidden md:inline">Renovar Ahora</span>
            <span className="md:hidden">Renovar</span>
          </a>
          <button
            onClick={() => setDismissed(true)}
            className="p-2 rounded hover:bg-white hover:bg-opacity-50 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
            title="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

