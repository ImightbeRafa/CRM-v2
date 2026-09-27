'use client';

import React, { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AuroraShell } from '@/components/aurora/AuroraShell';
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav';
import { AuroraPageHeader } from '@/components/aurora/shell/AuroraPageHeader';
import { PedidosBoard } from '@/app/ventas/components/PedidosBoard';
import SalesErrorBoundary from '@/app/ventas/components/SalesErrorBoundary';
import { DOMErrorBoundary } from '@/app/components/DOMErrorBoundary';
import { CrearPedidoDrawer } from '@/components/aurora/pedidos/CrearPedidoDrawer';
import { AuroraListSkeleton } from '@/components/aurora/states';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/app/hooks/use-toast';
import { parsePedidoParams, withPedidoParams } from '@/lib/pedido-url';
import { Plus } from 'lucide-react';

/**
 * /ventas: Pedidos list + detail drawer (`?pedido=`) + create drawer (`?nuevo=1`).
 * The create flow is the existing EnhancedSalesForm, framed by CrearPedidoDrawer.
 */
function VentasInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { pedido, nuevo, buscar } = parsePedidoParams(searchParams);

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const qs = withPedidoParams(new URLSearchParams(searchParams?.toString() ?? ''), changes);
      router.replace(`${pathname}${qs}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const openCreate = useCallback(() => setParams({ nuevo: '1' }), [setParams]);

  return (
    <AuroraShell fullBleed bottomNav={<AuroraMobileNav />}>
      <AuroraPageHeader
        title="Pedidos"
        subtitle="Ventas, pagos SINPE y envíos con Correos de Costa Rica"
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] px-4 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Crear pedido
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full space-y-4 px-4 py-4 sm:px-6">
          <DOMErrorBoundary>
            <SalesErrorBoundary>
              <PedidosBoard
                onCreate={openCreate}
                initialSearch={buscar}
                pedidoRef={pedido}
                onPedidoChange={(ref) => setParams({ pedido: ref })}
              />
            </SalesErrorBoundary>
          </DOMErrorBoundary>
        </div>
      </div>

      <CrearPedidoDrawer
        open={nuevo}
        onOpenChange={(open) => {
          if (!open) setParams({ nuevo: null });
        }}
        onCreated={(order) => {
          queryClient.invalidateQueries({ queryKey: ['sales'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
          toast({ variant: 'success' as any, title: 'Pedido creado', description: `#${order.orderId}` });
        }}
      />
    </AuroraShell>
  );
}

export default function VentasContent() {
  return (
    <Suspense fallback={<AuroraShell><AuroraListSkeleton rows={6} label="Cargando pedidos" /></AuroraShell>}>
      <VentasInner />
    </Suspense>
  );
}
