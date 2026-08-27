import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/app/hooks/use-toast';
import type { Sale } from '../produccion/types/sales';

interface StatusUpdateInput {
  orderId: string;
  status: string;
  expectedStatus?: string;
  expectedUpdatedAt?: string;
}

async function updateOrderStatus({ orderId, status, expectedStatus, expectedUpdatedAt }: StatusUpdateInput) {
  const idempotencyKey = expectedUpdatedAt ? `sales:${orderId}:${expectedUpdatedAt}:${status}` : undefined;
  const response = await fetch('/api/orders/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ orderId, status, expectedStatus, expectedUpdatedAt, idempotencyKey }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update order status (${response.status})`);
  }

  return response.json();
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: updateOrderStatus,

    onMutate: async ({ orderId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['sales'] });

      const previousData = queryClient.getQueriesData<Sale[]>({ queryKey: ['sales'] });

      queryClient.setQueriesData<Sale[]>({ queryKey: ['sales'] }, (old) => {
        if (!old) return old;
        return old.map((sale) =>
          sale.orderId === orderId ? { ...sale, status } : sale
        );
      });

      return { previousData };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousData) {
        for (const [queryKey, data] of context.previousData) {
          queryClient.setQueryData(queryKey, data);
        }
      }

      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar el estado. Se revirtió el cambio.',
      });
    },

    onSuccess: () => {
      toast({
        variant: 'success' as any,
        title: 'Estado actualizado',
        description: 'El estado del pedido se actualizó correctamente.',
      });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

interface CreateOrderInput {
  orderData: Record<string, any>;
}

async function createOrder({ orderData }: CreateOrderInput) {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(orderData),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to create order (${response.status})`);
  }

  return response.json();
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: createOrder,

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });

      toast({
        variant: 'success' as any,
        title: 'Pedido creado',
        description: 'El pedido se creó correctamente.',
      });
    },

    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Error al crear pedido',
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    },
  });
}
