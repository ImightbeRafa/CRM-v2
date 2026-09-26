import type { ReactNode } from 'react'
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
        icon="!"
        title={title}
        description={description}
        className={className}
        actions={
          <>
            {onRetry ? (
              <button type="button" onClick={onRetry} className={auroraButtonSecondary}>
                ↻ {retryLabel}
              </button>
            ) : null}
            {actions}
          </>
        }
      />
    </div>
  )
}
