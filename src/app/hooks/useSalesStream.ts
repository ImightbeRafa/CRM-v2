import { useMemo, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from "@/app/hooks/use-toast"
import { Sale } from '../produccion/types/sales'

interface SalesStreamOptions {
  onData?: (data: Sale[]) => void;
  onError?: (error: string) => void;
  pollingInterval?: number;
  enablePolling?: boolean;
  filters?: {
    status?: string;
    orderType?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}

function parseOrder(data: any): Sale | null {
  if (!data.orderId || typeof data.orderId !== 'string') return null;

  const commonFields = {
    id: data.id || data.orderId,
    orderId: data.orderId || '',
    status: data.status || 'Pendiente',
    delivery: data.delivery || '-',
    timestamp: data.timestamp || new Date().toISOString(),
    customerName: data.customerName || '',
    username: data.username || '',
    phone: data.phone || '',
    email: data.email || '',
    business: data.business || '',
    product: data.product || '',
    quantity: Number(data.quantity) || 0,
    size: data.size || '',
    color: data.color || '',
    packaging: data.packaging || '',
    customization: data.customization || '',
    comments: data.comments || '',
    total: Number(data.total) || 0,
    funnel: data.funnel || '',
    customFields: data.customFields ?? null,
    contraEntrega: data.contraEntrega === true,
    cePaymentConfirmed: data.cePaymentConfirmed === true,
  };

  if (data.orderType === 'EA') {
    return {
      ...commonFields,
      orderType: 'EA',
      expectedDate: data.expectedDate || '',
      saleDate: data.saleDate || '',
      courier: data.courier || '',
      seller: data.seller || '',
      province: data.province || '',
      canton: data.canton || '',
      district: data.district || '',
      address: data.address || '',
      productCost: Number(data.productCost) || 0,
      shippingCost: Number(data.shippingCost) || 0,
      iva: Number(data.iva) || 0,
    };
  } else if (data.orderType === 'RA') {
    return {
      ...commonFields,
      orderType: 'RA',
      seller: data.seller || '',
      agreedDate: data.agreedDate || '',
      pickupDate: data.pickupDate || '',
      productCost: Number(data.productCost) || 0,
      iva: Number(data.iva) || 0,
      address: data.address || '',
    };
  }

  return null;
}

async function fetchSalesData(filters: SalesStreamOptions['filters'] = {}): Promise<Sale[]> {
  const allSales: Sale[] = [];
  let page = 1;
  const limit = 500;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      limit: String(limit),
      page: String(page),
    });

    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.orderType && filters.orderType !== 'all') params.set('orderType', filters.orderType);
    if (filters.search) params.set('search', filters.search);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);

    const response = await fetch(`/api/orders?${params.toString()}`, {
      credentials: 'include',
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const result = await response.json();
    if (result.status === 'error') throw new Error(result.error || 'Unknown error');

    const pageSales = (result.data || [])
      .map(parseOrder)
      .filter((s: Sale | null): s is Sale => s !== null);
    allSales.push(...pageSales);

    hasMore = Boolean(result.pagination?.hasMore);
    page += 1;

    // Safety cap: avoid runaway loops if pagination metadata is wrong
    if (page > 50) break;
  }

  return Array.from(
    new Map<string, Sale>(allSales.map((sale) => [sale.orderId, sale])).values()
  );
}

export function useSalesStream({
  onData,
  onError,
  pollingInterval = 60000,
  enablePolling = true,
  filters = {}
}: SalesStreamOptions = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const filterKey = JSON.stringify(filters);

  const { data: sales = [], isLoading, error: queryError } = useQuery<Sale[], Error>({
    queryKey: ['sales', filterKey],
    queryFn: () => fetchSalesData(filters),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: enablePolling ? pollingInterval : false,
    refetchOnWindowFocus: false,
    retry: 1,
    meta: { onData, onError },
  });

  const error = queryError?.message ?? null;
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!queryError || !onError) return;
    if (lastErrorRef.current === queryError.message) return;
    lastErrorRef.current = queryError.message;
    onError(queryError.message);
  }, [queryError, onError]);

  const stats = useMemo(() => ({
    total: sales.length,
    eaOrders: sales.filter(s => s.orderType === 'EA').length,
    raOrders: sales.filter(s => s.orderType === 'RA').length,
    totalAmount: sales.reduce((sum, sale) => sum + sale.total, 0),
  }), [sales]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sales'] });
  }, [queryClient]);

  return {
    sales,
    isLoading,
    error,
    refresh,
    stats,
  };
}
