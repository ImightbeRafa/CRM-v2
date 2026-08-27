'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { AlertCircle, Clock, CreditCard, X } from 'lucide-react';

const PUBLIC_PATHS = [
  '/home', '/auth', '/privacy', '/terms',
  '/data-deletion', '/docs', '/help', '/unauthorized',
];

interface BillingAccess {
  state: 'ACTIVE' | 'GRACE' | 'RESTRICTED';
  effectiveRolloutMode: 'OBSERVE' | 'WARN' | 'ENFORCE';
  enforced: boolean;
  writeAllowed: boolean;
  graceEndsAt: string | null;
}

export default function SubscriptionBanner() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [access, setAccess] = useState<BillingAccess | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const isPublicRoute = PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
  const membershipRole = session?.user?.membershipRole || session?.user?.currentTenant?.role;
  const isOwner = membershipRole === 'OWNER';

  useEffect(() => {
    if (status !== 'authenticated' || isPublicRoute) return;

    const controller = new AbortController();
    fetch('/api/billing/access', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (payload?.status === 'success' && payload.data) setAccess(payload.data);
      })
      .catch(error => {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.warn('Billing access is temporarily unavailable');
        }
      });

    return () => controller.abort();
  }, [status, isPublicRoute, pathname]);

  if (status !== 'authenticated' || isPublicRoute || dismissed || !access || access.state === 'ACTIVE') {
    return null;
  }

  const enforced = access.state === 'RESTRICTED' && access.enforced;
  const observingRestriction = access.state === 'RESTRICTED' && !access.enforced;
  const graceDate = access.graceEndsAt
    ? new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium' }).format(new Date(access.graceEndsAt))
    : null;

  const title = enforced
    ? 'Cuenta restringida por facturación'
    : observingRestriction
      ? access.effectiveRolloutMode === 'WARN' ? 'Aviso de facturación' : 'Facturación en observación'
      : 'Período de gracia activo';
  const description = enforced
    ? isOwner
      ? 'Los cambios del equipo están pausados. Puedes renovar la suscripción ahora.'
      : 'Los cambios están pausados. Pide al propietario que renueve la suscripción.'
    : observingRestriction
      ? 'La cuenta todavía puede trabajar, pero quedaría restringida cuando se apruebe la aplicación del bloqueo.'
      : `La cuenta sigue operativa${graceDate ? ` hasta el ${graceDate}` : ''}. Renueva para evitar interrupciones.`;

  const colors = enforced
    ? 'bg-red-600 text-white border-red-700'
    : observingRestriction
      ? 'bg-orange-100 text-orange-950 border-orange-300 dark:bg-orange-950 dark:text-orange-100 dark:border-orange-800'
      : 'bg-yellow-100 text-yellow-950 border-yellow-300 dark:bg-yellow-950 dark:text-yellow-100 dark:border-yellow-800';

  return (
    <div className={`sticky top-0 z-50 border-b px-3 py-2 shadow-md md:px-4 md:py-3 ${colors}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
          {access.state === 'GRACE'
            ? <Clock className="h-4 w-4 flex-shrink-0 md:h-5 md:w-5" />
            : <AlertCircle className="h-4 w-4 flex-shrink-0 md:h-5 md:w-5" />}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold md:text-sm">{title}</p>
            <p className="hidden text-xs opacity-90 md:block">{description}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1 md:gap-2">
          {isOwner && (
            <a
              href="/config?tab=billing"
              className="flex items-center gap-1 whitespace-nowrap rounded border border-current/20 bg-white px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted md:px-3 md:py-1.5 md:text-sm"
            >
              <CreditCard className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Renovar
            </a>
          )}
          {!enforced && (
            <button
              onClick={() => setDismissed(true)}
              className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded p-2 transition-colors hover:bg-black/10"
              title="Cerrar"
              aria-label="Cerrar aviso de facturación"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
