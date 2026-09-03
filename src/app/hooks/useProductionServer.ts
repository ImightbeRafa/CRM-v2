import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { parseOrder } from '@/app/hooks/useSalesStream';
import type { Sale } from '@/app/produccion/types/sales';

export interface ProductionFilters {
  search?: string;
  orderType?: 'EA' | 'RA' | '';
  dateFrom?: string;
  dateTo?: string;
  courier?: string;
  priority?: 'urgent' | 'high' | 'normal' | '';
  contraEntrega?: boolean;
}

export interface ProductionStatusMetadata {
  id: string;
  key: string;
  label: string;
  color: string | null;
  order: number;
  isActive: boolean;
  count: number;
}

interface MetadataResponse {
  enabled: boolean;
  reason?: string;
  statuses?: ProductionStatusMetadata[];
  unconfiguredCount?: number;
  terminalFilteringEnabled?: boolean;
  mappingRevision?: string | null;
}

interface OrdersPage {
  items: Sale[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
  totalCount: number;
  retentionMode: 'all' | 'open_plus_30_terminal';
  asOf: string;
}

function appendFilters(params: URLSearchParams, filters: ProductionFilters) {
  if (filters.search && filters.search.trim().length >= 2) params.set('search', filters.search.trim());
  if (filters.orderType) params.set('orderType', filters.orderType);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.courier && filters.courier !== 'all') params.set('courier', filters.courier);
  if (filters.priority && filters.priority !== 'normal') params.set('priority', filters.priority);
  if (filters.contraEntrega) params.set('contraEntrega', '1');
}

async function fetchJson(url: string) {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
  return json;
}

function useTenantKey() {
  const { data: session } = useSession();
  return session?.user?.currentTenant?.id || session?.user?.tenantId || 'no-tenant';
}

export function useProductionMetadata() {
  const tenantKey = useTenantKey();
  return useQuery<MetadataResponse, Error>({
    queryKey: ['production', tenantKey, 'metadata'],
    queryFn: async () => (await fetchJson('/api/production/metadata')).data as MetadataResponse,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useProductionOrders(args: {
  enabled: boolean;
  view?: 'list' | 'column';
  statusId?: string;
  unconfigured?: boolean;
  filters?: ProductionFilters;
  limit?: number;
}) {
  const tenantKey = useTenantKey();
  const view = args.view || 'list';
  const filters = args.filters || {};
  const query = useInfiniteQuery<OrdersPage, Error>({
    queryKey: ['production', tenantKey, 'orders', view, args.statusId || '', args.unconfigured || false, filters, args.limit || 'default'],
    enabled: args.enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ view, limit: String(args.limit || (view === 'column' ? 20 : 60)) });
      if (args.statusId) params.set('statusId', args.statusId);
      if (args.unconfigured) params.set('column', 'unconfigured');
      if (typeof pageParam === 'string' && pageParam) params.set('cursor', pageParam);
      appendFilters(params, filters);
      const json = await fetchJson(`/api/production/orders?${params.toString()}`);
      return {
        ...json.data,
        items: (json.data.items || []).map(parseOrder).filter((item: Sale | null): item is Sale => item !== null),
      } as OrdersPage;
    },
    getNextPageParam: lastPage => lastPage.pageInfo.nextCursor || undefined,
    staleTime: 20_000,
    refetchInterval: view === 'list' ? 30_000 : 60_000,
    refetchOnWindowFocus: false,
  });
  const orders = useMemo(() => {
    const unique = new Map<string, Sale>();
    for (const page of query.data?.pages || []) {
      for (const order of page.items) unique.set(order.id, order);
    }
    return [...unique.values()];
  }, [query.data]);
  return {
    ...query,
    orders,
    totalCount: query.data?.pages[0]?.totalCount || 0,
    retentionMode: query.data?.pages[0]?.retentionMode || 'all',
  };
}

export function useProductionSummary(filters: ProductionFilters, enabled: boolean) {
  const tenantKey = useTenantKey();
  return useQuery<{
    total: number; eaOrders: number; raOrders: number; urgentOrders: number; totalAmount: number; asOf: string;
  }, Error>({
    queryKey: ['production', tenantKey, 'summary', filters],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams();
      appendFilters(params, filters);
      return (await fetchJson(`/api/production/summary?${params.toString()}`)).data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useProductionStatusMove() {
  const tenantKey = useTenantKey();
  const queryClient = useQueryClient();
  return useCallback(async (order: Sale, status: string) => {
    const idempotencyKey = `production:${order.id}:${order.updatedAt}:${status}`;
    const response = await fetch('/api/orders/status', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        orderId: order.orderId,
        status,
        expectedStatus: order.status,
        expectedUpdatedAt: order.updatedAt,
        idempotencyKey,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(json.error || 'No se pudo actualizar el estado') as Error & { code?: string };
      error.code = json.code;
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey: ['production', tenantKey] });
    return json.data as Sale;
  }, [queryClient, tenantKey]);
}
