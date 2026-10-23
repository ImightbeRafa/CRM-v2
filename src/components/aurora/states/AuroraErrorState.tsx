import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { AuroraEmptyState, auroraButtonSecondary } from './AuroraEmptyState'

type AuroraErrorStateProps = {
  title: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  actions?: ReactNode
  className?: string
}

/** STATE-01 · "Error de carga": icon, human sentence, Reintentar. */
export function AuroraErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Reintentar',
  actions,
  className,
}: AuroraErrorStateProps) {
  return (
    <div role="alert" data-testid="aurora-error-state">
      <AuroraEmptyState
        tone="danger"
        icon={<AlertTriangle className="h-6 w-6" aria-hidden />}
        title={title}
        description={description}
        className={className}
        actions={
          <>
            {onRetry ? (
              <button type="button" onClick={onRetry} className={`${auroraButtonSecondary} inline-flex items-center gap-1.5`}>
                <RotateCw className="h-3.5 w-3.5" aria-hidden />
                {retryLabel}
              </button>
            ) : null}
            {actions}
          </>
        }
      />
    </div>
  )
}
