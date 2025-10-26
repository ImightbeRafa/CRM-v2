'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, Clock, Zap } from 'lucide-react';

/**
 * Trial Banner Component
 * Shows trial status and days remaining at top of app
 */
export default function TrialBanner() {
  const [trialStatus, setTrialStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTrialStatus();
  }, []);

  const loadTrialStatus = async () => {
    try {
      const response = await fetch('/api/billing/trial-status', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setTrialStatus(data);
      }
    } catch (error) {
      console.error('Failed to load trial status:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !trialStatus) {
    return null;
  }

  // Don't show banner if not in trial or already on paid plan
  if (!trialStatus.isInTrial && trialStatus.currentPlan !== 'FREE') {
    return null;
  }

  // Trial expired
  if (trialStatus.trialExpired) {
    return (
      <div className="bg-red-600 text-white px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Tu prueba gratuita ha expirado</p>
              <p className="text-sm opacity-90">Actualiza tu plan para seguir usando todas las funciones</p>
            </div>
          </div>
          <div className="flex gap-2">
            <a
              href="https://tp.cr/l/TkRFMU1BPT18MQ=="
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-white text-red-600 rounded-lg font-semibold hover:bg-gray-100 transition text-sm"
            >
              Plan Basic ($20/mes)
            </a>
            <a
              href="/config?tab=billing"
              className="px-4 py-2 bg-yellow-400 text-red-900 rounded-lg font-semibold hover:bg-yellow-300 transition text-sm"
            >
              Pro (Próximamente)
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Active trial - show warning in last 3 days
  if (trialStatus.daysRemaining <= 3) {
    return (
      <div className="bg-yellow-500 text-yellow-900 px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">
                {trialStatus.daysRemaining === 1 
                  ? '¡Último día de prueba gratuita!' 
                  : `${trialStatus.daysRemaining} días restantes de prueba gratuita`
                }
              </p>
              <p className="text-sm opacity-90">Actualiza ahora para continuar sin interrupciones</p>
            </div>
          </div>
          <div className="flex gap-2">
            <a
              href="https://tp.cr/l/TkRFMU1BPT18MQ=="
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-white text-yellow-900 rounded-lg font-semibold hover:bg-gray-100 transition text-sm"
            >
              Basic
            </a>
            <a
              href="/config?tab=billing"
              className="px-3 py-1.5 bg-yellow-900 text-white rounded-lg font-semibold hover:bg-yellow-800 transition text-sm"
            >
              Pro (Próximamente)
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Active trial with plenty of time left
  return (
    <div className="bg-blue-600 text-white px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Zap className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">
            <span className="font-semibold">{trialStatus.daysRemaining} días</span> restantes de prueba gratuita
          </p>
        </div>
        <a
          href="/config?tab=billing"
          className="text-sm text-white underline hover:no-underline"
        >
          Ver planes
        </a>
      </div>
    </div>
  );
}

