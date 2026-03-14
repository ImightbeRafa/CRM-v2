import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

interface DashboardStats {
  ordersWeek: number;
  pendingOrders: number;
  totalClients: number;
  weeklyRevenue: number;
  ordersChange: number;
  newClientsThisWeek: number;
  revenueChange: number;
}

const defaultStats: DashboardStats = {
  ordersWeek: 0,
  pendingOrders: 0,
  totalClients: 0,
  weeklyRevenue: 0,
  ordersChange: 0,
  newClientsThisWeek: 0,
  revenueChange: 0,
};

async function fetchDashboardStats(forceRefresh = false): Promise<DashboardStats> {
  const url = forceRefresh ? '/api/dashboard/stats?refresh=true' : '/api/dashboard/stats';
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) throw new Error('Failed to fetch dashboard stats');

  return response.json();
}

export function useDashboardStats() {
  const queryClient = useQueryClient();

  const { data: stats = defaultStats, isLoading, error } = useQuery<DashboardStats, Error>({
    queryKey: ['dashboard-stats'],
    queryFn: () => fetchDashboardStats(false),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const refresh = useCallback((forceRefresh = false) => {
    if (forceRefresh) {
      queryClient.fetchQuery({
        queryKey: ['dashboard-stats'],
        queryFn: () => fetchDashboardStats(true),
      });
    } else {
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    }
  }, [queryClient]);

  return { stats, isLoading, error: error?.message ?? null, refresh };
}
