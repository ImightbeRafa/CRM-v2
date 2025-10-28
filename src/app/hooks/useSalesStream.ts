// hooks/useSalesStream.ts
import { useEffect, useState, useCallback, useMemo } from 'react'
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

export function useSalesStream({
  onData,
  onError,
  pollingInterval = 60000, // Increased to 60s (was 30s)
  enablePolling = true,
  filters = {}
}: SalesStreamOptions = {}) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [isMounted, setIsMounted] = useState(true);
  const { toast } = useToast();

  // Don't clear cache on mount - use smart caching instead
  // Cache is valid for 30 seconds

  const parseOrder = useCallback((data: any): Sale | null => {
    // Validate required fields and format
    if (!data.orderId || typeof data.orderId !== 'string') {
      console.warn('Invalid order format:', data);
      return null;
    }

    const commonFields = {
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
  }, []);

  const fetchSales = useCallback(async (force = false) => {
    // Check cache first (5 second TTL for faster updates)
    const now = Date.now();
    if (!force && now - lastFetch < 5000) {
      const cached = localStorage.getItem('salesCache');
      if (cached) {
        try {
          const { data, timestamp } = JSON.parse(cached);
          if (now - timestamp < 5000) {
            console.log('[useSalesStream] Using cached sales data');
            setSales(data);
            setIsLoading(false);
            return;
          }
        } catch (e) {
          console.warn('Failed to parse cache:', e);
          localStorage.removeItem('salesCache');
        }
      }
    }
    
    console.log('[useSalesStream] Fetching fresh data from API');

    try {
      // Build query params with filters
      const params = new URLSearchParams({
        limit: '500', // Fetch more at once to reduce requests
        page: '1'
      });

      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.orderType && filters.orderType !== 'all') params.set('orderType', filters.orderType);
      if (filters.search) params.set('search', filters.search);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);

      const response = await fetch(`/api/orders?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.status === 'error') {
        throw new Error(result.error || 'Unknown error');
      }

      // Filter out invalid orders and parse valid ones
      const parsedSales: Sale[] = result.data
        .map(parseOrder)
        .filter((sale: Sale | null): sale is Sale => sale !== null);

      // Deduplicate sales by orderId
      const uniqueSales: Sale[] = Array.from(
        new Map(parsedSales.map((sale: Sale) => [sale.orderId, sale])).values()
      );

      // Only update state if component is still mounted
      if (isMounted) {
        // Update cache with new data
        const cacheData = {
          data: uniqueSales,
          timestamp: now
        };
        localStorage.setItem('salesCache', JSON.stringify(cacheData));
        setLastFetch(now);

        setSales(uniqueSales);
        onData?.(uniqueSales);
        setError(null);
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch sales data';
      console.error('Error fetching sales:', errorMessage);
      
      if (isMounted) {
        setError(errorMessage);
        onError?.(errorMessage);

        toast({
          variant: "destructive",
          title: "Error",
          description: errorMessage,
        });
      }
    } finally {
      if (isMounted) {
        setIsLoading(false);
      }
    }
  }, [onData, onError, toast, parseOrder, filters, lastFetch]);

  useEffect(() => {
    // Clear cache on mount to ensure fresh data
    localStorage.removeItem('salesCache');
    setLastFetch(0);
    fetchSales(true); // Force fetch on mount
    
    return () => {
      setIsMounted(false);
    };
  }, []); // Only on mount

  // Refetch when filters change
  useEffect(() => {
    if (lastFetch > 0) { // Skip initial mount
      fetchSales(true);
    }
  }, [filters.status, filters.orderType, filters.search, filters.dateFrom, filters.dateTo]);

  // Optional polling (disabled by default for better performance)
  useEffect(() => {
    if (!enablePolling) return;

    const intervalId = setInterval(() => fetchSales(false), pollingInterval);
    return () => clearInterval(intervalId);
  }, [enablePolling, pollingInterval]);

  const stats = useMemo(() => ({
    total: sales.length,
    eaOrders: sales.filter(s => s.orderType === 'EA').length,
    raOrders: sales.filter(s => s.orderType === 'RA').length,
    totalAmount: sales.reduce((sum, sale) => sum + sale.total, 0),
  }), [sales]);

  // Invalidate cache and force refresh
  const invalidateAndRefresh = useCallback(() => {
    console.log('[useSalesStream] Invalidating cache and refreshing');
    localStorage.removeItem('salesCache');
    setLastFetch(0);
    return fetchSales(true);
  }, [fetchSales]);

  return {
    sales,
    isLoading,
    error,
    refresh: invalidateAndRefresh, // Invalidate cache and force refresh
    stats
  };
}