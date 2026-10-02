'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/lib/observability/client-report';
import {
  AuthShell,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
} from '@/components/aurora/auth/AuthShell';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <AuthShell
      brandPanel={false}
      icon={
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
      }
      title="Algo salió mal"
      subtitle="Ya registramos el error y lo vamos a revisar. Podés intentar de nuevo."
    >
      {process.env.NODE_ENV === 'development' && (
        <details className="mb-5 text-left">
          <summary className="mb-2 cursor-pointer text-[13px] text-slate-500">
            Detalles del error (solo desarrollo)
          </summary>
          <pre className="max-h-32 overflow-auto rounded-lg bg-slate-100 p-2 text-xs">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>
      )}

      <div className="flex flex-col gap-3">
        <button type="button" onClick={reset} className={authPrimaryButtonClass}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Intentar de nuevo
        </button>
        <button
          type="button"
          onClick={() => (window.location.href = '/')}
          className={authSecondaryButtonClass}
        >
          Ir al inicio
        </button>
      </div>

      <p className="mt-5 text-center text-xs text-slate-400">
        ID del error: {error.digest || 'desconocido'}
      </p>
    </AuthShell>
  );
}
