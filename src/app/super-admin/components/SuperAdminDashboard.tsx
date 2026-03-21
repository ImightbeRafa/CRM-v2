'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, TrendingUp, Users, Building2, ShoppingCart, DollarSign } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';

interface SuperAdminStats {
  summary: {
    totalTenants: number;
    activeTenants: number;
    totalOrders: number;
    totalClients: number;
    totalRevenue: number;
    activeUsers: number;
    ordersToday: number;
    ordersThisWeek: number;
    ordersThisMonth: number;
  };
  tenantsByPlan: Record<string, number>;
  topTenants: Array<{
    name: string;
    slug: string;
    orders: number;
    clients: number;
    users: number;
    plan: string;
    status: string | null;
  }>;
  allTenants: Array<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    isActive: boolean;
    subscriptionStatus: string | null;
    createdAt: string;
    stats: {
      orders: number;
      clients: number;
      users: number;
    };
  }>;
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<SuperAdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/super-admin/stats');
      
      if (response.status === 403) {
        setError('Access denied. Super admin privileges required.');
        return;
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch stats');
      }
      
      const data = await response.json();
      setStats(data);
      setError('');
    } catch (err) {
      console.error('[Super Admin] Error fetching stats:', err);
      setError('Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('es-CR', { maximumFractionDigits: 0 });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading super admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 text-lg">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">🔐 Super Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Cross-tenant monitoring and analytics</p>
        </div>
        <button
          onClick={fetchStats}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Global Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <Card className="border-l-4 border-l-blue-600">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Total Tenants
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.summary.totalTenants}</p>
            <p className="text-sm text-green-600 mt-1">
              {stats.summary.activeTenants} active
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-600">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Total Orders
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatCurrency(stats.summary.totalOrders)}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {stats.summary.ordersThisWeek} this week
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-600">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Revenue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">₡{formatCurrency(stats.summary.totalRevenue)}</p>
            <p className="text-sm text-muted-foreground mt-1">All time</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-600">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Active Users
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.summary.activeUsers}</p>
            <p className="text-sm text-muted-foreground mt-1">Platform-wide</p>
          </CardContent>
        </Card>
      </div>

      {/* Tenants by Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Tenants by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(stats.tenantsByPlan).map(([plan, count]) => (
                <div key={plan} className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">{plan}</span>
                  <span className="bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400 px-3 py-1 rounded-full text-sm font-bold">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Tenants by Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.topTenants.slice(0, 5).map((tenant, i) => (
                <div key={tenant.slug} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-foreground">
                      {i + 1}. {tenant.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{tenant.plan}</p>
                  </div>
                  <span className="text-blue-600 dark:text-blue-400 font-bold">{tenant.orders}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All Tenants Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Tenants</CardTitle>
          <CardDescription>Complete list of all platform tenants</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4">Tenant</th>
                  <th className="text-left py-3 px-4">Plan</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-right py-3 px-4">Orders</th>
                  <th className="text-right py-3 px-4">Clients</th>
                  <th className="text-right py-3 px-4">Users</th>
                  <th className="text-left py-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {stats.allTenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b border-border hover:bg-muted/50">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium">{tenant.name}</p>
                        <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        tenant.plan === 'PRO' ? 'bg-purple-100 dark:bg-purple-950/30 text-purple-800 dark:text-purple-400' :
                        tenant.plan === 'BASIC' ? 'bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400' :
                        'bg-muted text-foreground'
                      }`}>
                        {tenant.plan}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        tenant.isActive ? 'bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-400' : 'bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-400'
                      }`}>
                        {tenant.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">{tenant.stats.orders}</td>
                    <td className="py-3 px-4 text-right">{tenant.stats.clients}</td>
                    <td className="py-3 px-4 text-right">{tenant.stats.users}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
