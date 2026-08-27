'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { CheckCircle, Download, Edit, Loader2, Mail, MapPin, Plus, RefreshCw, Search, Star, Trash2, TrendingUp, Users, X } from 'lucide-react';

interface ManagedClient {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  province: string;
  canton: string;
  district: string;
  address?: string | null;
  business?: string | null;
  username?: string | null;
  notes?: string | null;
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  firstOrder: string;
  lastOrder: string;
  isActive: boolean;
  isFavorite: boolean;
}

interface ClientStats {
  totalClients: number;
  activeClients: number;
  newClientsThisMonth: number;
  totalRevenue: number;
  averageOrderValue: number;
}

const emptyStats: ClientStats = { totalClients: 0, activeClients: 0, newClientsThisMonth: 0, totalRevenue: 0, averageOrderValue: 0 };
const emptyForm = { name: '', phone: '', email: '', province: '', canton: '', district: '', address: '', business: '', username: '', notes: '', isFavorite: false };

function ClientHistory({ client, onClose }: { client: ManagedClient; onClose: () => void }) {
  const [orders, setOrders] = useState<Array<{ id: string; orderId: string; status: string; total: number; product: string | null; timestamp: string; orderType: string }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (next?: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (next) params.set('cursor', next);
      const response = await fetch(`/api/config/automatic-clients/${client.id}/orders?${params}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'No se pudo cargar el historial');
      setOrders(previous => next ? [...previous, ...json.data.items] : json.data.items);
      setCursor(json.data.pageInfo.nextCursor);
      setHasMore(json.data.pageInfo.hasMore);
    } catch (error) {
      console.error('[ClientHistory]', error);
    } finally {
      setLoading(false);
    }
  }, [client.id]);
  useEffect(() => { void load(); }, [load]);
  return <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-center justify-center">
    <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
      <CardContent className="p-5 space-y-4">
        <div className="flex justify-between items-start"><div><h2 className="text-xl font-bold">{client.name}</h2><p className="text-sm text-muted-foreground">Historial enlazado por Client ID</p></div><Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button></div>
        {orders.map(order => <div key={order.id} className="border rounded-lg p-3 flex justify-between gap-4"><div><strong>#{order.orderId}</strong><p className="text-sm text-muted-foreground">{order.product || 'Sin producto'} · {new Date(order.timestamp).toLocaleDateString('es-CR')}</p></div><div className="text-right"><Badge variant="outline">{order.status}</Badge><p className="font-semibold mt-1">₡{Number(order.total).toLocaleString('es-CR')}</p></div></div>)}
        {loading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {!loading && orders.length === 0 && <p className="text-center text-muted-foreground py-8">No hay pedidos enlazados.</p>}
        {hasMore && <Button variant="outline" className="w-full" disabled={loading} onClick={() => void load(cursor)}>Cargar más historial</Button>}
      </CardContent>
    </Card>
  </div>;
}

export function PaginatedClientManagement({ onUnavailable }: { onUnavailable: () => void }) {
  const { data: session } = useSession();
  const tenantKey = session?.user?.currentTenant?.id || session?.user?.tenantId || '';
  const [dataTenantKey, setDataTenantKey] = useState(tenantKey);
  const [clients, setClients] = useState<ManagedClient[]>([]);
  const [stats, setStats] = useState<ClientStats>(emptyStats);
  const [facets, setFacets] = useState<Array<{ province: string; canton: string }>>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [location, setLocation] = useState('all');
  const [state, setState] = useState('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<ManagedClient | null>(null);
  const [editing, setEditing] = useState<ManagedClient | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ limit: '50', state });
    if (debouncedSearch.length >= 2) params.set('search', debouncedSearch);
    if (location !== 'all') {
      const [province, canton = ''] = location.split('|');
      params.set('province', province);
      if (canton) params.set('canton', canton);
    }
    return params;
  }, [debouncedSearch, location, state]);

  const loadClients = useCallback(async (nextCursor?: string | null) => {
    nextCursor ? setLoadingMore(true) : setLoading(true);
    try {
      const params = new URLSearchParams(filterParams);
      if (nextCursor) params.set('cursor', nextCursor);
      const response = await fetch(`/api/config/automatic-clients/v2?${params}`, { credentials: 'include', cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (response.status === 409) return onUnavailable();
      if (!response.ok) throw new Error(json.error || 'No se pudieron cargar los clientes');
      setClients(previous => nextCursor ? [...previous, ...json.data.items] : json.data.items);
      setDataTenantKey(tenantKey);
      setStats(json.data.stats);
      setFacets(json.data.facets || []);
      setCursor(json.data.pageInfo.nextCursor);
      setHasMore(json.data.pageInfo.hasMore);
    } catch (error) {
      console.error('[PaginatedClientManagement]', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filterParams, onUnavailable, tenantKey]);

  const filterKey = filterParams.toString();
  useEffect(() => { setClients([]); setCursor(null); void loadClients(); }, [filterKey, loadClients, tenantKey]);

  const openForm = (client?: ManagedClient) => {
    setEditing(client || null);
    setForm(client ? {
      name: client.name, phone: client.phone, email: client.email || '', province: client.province,
      canton: client.canton, district: client.district, address: client.address || '', business: client.business || '',
      username: client.username || '', notes: client.notes || '', isFavorite: client.isFavorite,
    } : emptyForm);
    setShowForm(true);
  };
  const saveClient = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/config/automatic-clients', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(editing ? { id: editing.id, ...form } : form),
    });
    if (response.ok) { setShowForm(false); setEditing(null); await loadClients(); }
  };
  const removeClient = async (client: ManagedClient) => {
    if (!confirm(`¿Desactivar a ${client.name}?`)) return;
    const response = await fetch(`/api/config/automatic-clients?id=${client.id}`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) await loadClients();
  };
  const sync = async () => {
    const response = await fetch('/api/config/automatic-clients/sync', { method: 'POST', credentials: 'include' });
    if (response.ok) await loadClients();
  };
  const exportClients = () => {
    const params = new URLSearchParams(filterParams);
    params.set('format', 'xlsx');
    params.set('includeStats', 'true');
    window.location.assign(`/api/exports/clients?${params}`);
  };

  if (dataTenantKey !== tenantKey || (loading && clients.length === 0)) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return <div className="space-y-6">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Gestión Automática de Clientes</h1><p className="text-muted-foreground">Clientes paginados y enlazados desde las ventas</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void sync()}><RefreshCw className="h-4 w-4 mr-2" />Sincronizar</Button><Button variant="outline" onClick={exportClients}><Download className="h-4 w-4 mr-2" />Exportar</Button><Button onClick={() => openForm()}><Plus className="h-4 w-4 mr-2" />Agregar Cliente</Button></div></div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[['Total Clientes', stats.totalClients, <Users key="users" className="h-7 w-7 text-blue-600" />], ['Clientes Activos', stats.activeClients, <CheckCircle key="active" className="h-7 w-7 text-green-600" />], ['Nuevos Este Mes', stats.newClientsThisMonth, <TrendingUp key="new" className="h-7 w-7 text-blue-600" />], ['Ingresos Totales', `₡${stats.totalRevenue.toLocaleString('es-CR')}`, <TrendingUp key="revenue" className="h-7 w-7 text-green-600" />]].map(([label, value, icon]) => <Card key={String(label)}><CardContent className="p-4 flex justify-between"><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>{icon}</CardContent></Card>)}
    </div>
    <Card><CardContent className="p-4 flex flex-wrap gap-3"><div className="relative flex-1 min-w-64"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-10" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar clientes..." /></div><select className="px-3 py-2 border rounded-md bg-background" value={location} onChange={event => setLocation(event.target.value)}><option value="all">Todas las ubicaciones</option>{facets.map(facet => <option key={`${facet.province}|${facet.canton}`} value={`${facet.province}|${facet.canton}`}>{facet.province} · {facet.canton}</option>)}</select><select className="px-3 py-2 border rounded-md bg-background" value={state} onChange={event => setState(event.target.value)}><option value="all">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="favorites">Favoritos</option><option value="top-spenders">Top gastadores</option></select></CardContent></Card>
    {showForm && <Card><CardContent className="p-5"><form onSubmit={saveClient} className="grid grid-cols-1 md:grid-cols-2 gap-3">{(['name','phone','email','province','canton','district','address','business','username','notes'] as const).map(field => <Input key={field} required={['name','phone','province','canton','district'].includes(field)} value={String(form[field])} onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))} placeholder={field} />)}<label className="flex items-center gap-2"><input type="checkbox" checked={form.isFavorite} onChange={event => setForm(previous => ({ ...previous, isFavorite: event.target.checked }))} /><Star className="h-4 w-4" />Favorito</label><div className="flex gap-2 justify-end"><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button><Button type="submit">{editing ? 'Actualizar' : 'Crear'}</Button></div></form></CardContent></Card>}
    <div className="space-y-3">{clients.map(client => <Card key={client.id}><CardContent className="p-4 flex flex-col lg:flex-row justify-between gap-4"><button type="button" className="text-left flex-1" onClick={() => setSelected(client)}><div className="flex flex-wrap gap-2 items-center"><strong>{client.name}</strong>{client.isFavorite && <Badge><Star className="h-3 w-3 mr-1" />VIP</Badge>}<Badge variant="outline">{client.totalOrders} pedidos</Badge>{!client.isActive && <Badge variant="destructive">Inactivo</Badge>}</div><div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-muted-foreground mt-3"><span>{client.phone}</span><span className="flex items-center"><Mail className="h-3 w-3 mr-1" />{client.email || 'Sin email'}</span><span className="flex items-center"><MapPin className="h-3 w-3 mr-1" />{client.province}, {client.canton}</span><span>Total: ₡{client.totalSpent.toLocaleString('es-CR')}</span><span>Promedio: ₡{client.averageOrderValue.toLocaleString('es-CR')}</span><span>Último: {new Date(client.lastOrder).toLocaleDateString('es-CR')}</span></div></button><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openForm(client)}><Edit className="h-4 w-4" /></Button><Button size="sm" variant="outline" className="text-red-600" onClick={() => void removeClient(client)}><Trash2 className="h-4 w-4" /></Button></div></CardContent></Card>)}</div>
    {!loading && clients.length === 0 && <Card><CardContent className="p-8 text-center text-muted-foreground">No hay clientes que coincidan con los filtros.</CardContent></Card>}
    {hasMore && <Button variant="outline" className="w-full" disabled={loadingMore} onClick={() => void loadClients(cursor)}>{loadingMore && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Cargar más clientes</Button>}
    {selected && <ClientHistory client={selected} onClose={() => setSelected(null)} />}
  </div>;
}
