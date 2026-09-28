'use client'

import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'
import { AuroraDrawer } from '@/components/aurora/ui/AuroraDrawer'
import { DOMErrorBoundary } from '@/app/components/DOMErrorBoundary'
import SalesErrorBoundary from '@/app/ventas/components/SalesErrorBoundary'
import type { CreatedOrderRef, OrderFormPrefill } from '@/app/ventas/components/EnhancedSalesForm'

// The same create-order form (fields, validation, SINPE / Correos) — only its frame changes.
const EnhancedSalesForm = lazy(() => import('@/app/ventas/components/EnhancedSalesForm'))

function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-5" role="status" aria-label="Cargando formulario">
      <div className="h-8 w-1/3 rounded bg-slate-100" />
      <div className="h-24 rounded-2xl bg-white" />
      <div className="h-24 rounded-2xl bg-white" />
      <div className="h-40 rounded-2xl bg-white" />
      <div className="flex items-center gap-2 text-au-ink-5b6cff">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="text-[13px]">Cargando formulario…</span>
      </div>
    </div>
  )
}

type CrearPedidoDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After the order exists (list refresh, chat link). Never rolls the order back on failure. */
  onCreated?: (order: CreatedOrderRef) => void | Promise<void>
  prefill?: OrderFormPrefill
  /** Shown under the title, e.g. "Desde el chat con María". */
  subtitle?: string
  /** Per-chat draft slot (`chat:<id>`): an unfinished order survives closing / switching chats. */
  draftKey?: string
}

/** "Crear pedido": Aurora drawer (full-screen sheet on mobile) around the existing sales form. */
export function CrearPedidoDrawer({ open, onOpenChange, onCreated, prefill, subtitle, draftKey }: CrearPedidoDrawerProps) {
  const handleCreated = async (order: CreatedOrderRef) => {
    // The order exists: close now; the hand-off (list refresh, chat link) must not hold the drawer.
    onOpenChange(false)
    void Promise.resolve()
      .then(() => onCreated?.(order))
      .catch((error) => console.warn('Crear pedido hand-off failed:', error))
  }

  return (
    <AuroraDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Crear pedido"
      subtitle={subtitle ?? 'Los mismos datos y validaciones de siempre, incluido SINPE y Correos de Costa Rica'}
      widthClass="md:max-w-[760px]"
    >
      <div className="px-4 py-4 sm:px-5" data-testid="crear-pedido-body">
        <DOMErrorBoundary>
          <SalesErrorBoundary>
            <Suspense fallback={<FormSkeleton />}>
              <EnhancedSalesForm
                showOrderForm
                onToggleForm={(show) => {
                  if (!show) onOpenChange(false)
                }}
                onCreated={handleCreated}
                prefill={prefill}
                draftKey={draftKey}
                embedded
              />
            </Suspense>
          </SalesErrorBoundary>
        </DOMErrorBoundary>
      </div>
    </AuroraDrawer>
  )
}
