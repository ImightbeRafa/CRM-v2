"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { 
  Users, 
  Plus, 
  Edit, 
  Trash2, 
  Search,
  Filter,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  MapPin,
  Phone,
  Mail,
  Building,
  Star,
  Eye,
  EyeOff,
  RefreshCw,
  Settings
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  province: string;
  canton: string;
  district: string;
  address?: string;
  business?: string;
  username?: string;
  totalOrders: number;
  totalSpent: number;
  lastOrder: string;
  firstOrder: string;
  isActive: boolean;
  isFavorite: boolean;
  averageOrderValue: number;
  preferredProducts: string[];
  notes?: string;
}

interface ClientStats {
  totalClients: number;
  activeClients: number;
  newClientsThisMonth: number;
  topSpenders: number;
  averageOrderValue: number;
  totalRevenue: number;
}

export function AutomaticClientManagement() {
  const { user, loading: userLoading } = useCurrentUser();
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState<ClientStats>({
    totalClients: 0,
    activeClients: 0,
    newClientsThisMonth: 0,
    topSpenders: 0,
    averageOrderValue: 0,
    totalRevenue: 0
  });

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    province: '',
    canton: '',
    district: '',
    address: '',
    business: '',
    username: '',
    notes: '',
    isFavorite: false
  });

  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    filterClients();
  }, [clients, searchTerm, locationFilter, statusFilter]);

  const loadClients = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/config/automatic-clients', { credentials: 'include' });
      const result = await response.json();
      
      if (result.status === 'success') {
        setClients(result.data);
        calculateStats(result.data);
      }
    } catch (error) {
      console.error('Error loading clients:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (clients: Client[]) => {
    const totalClients = clients.length;
    const activeClients = clients.filter(c => c.isActive).length;
    const thisMonth = new Date();
    thisMonth.setDate(1);
    const newClientsThisMonth = clients.filter(c => new Date(c.firstOrder) >= thisMonth).length;
    const topSpenders = clients.filter(c => c.totalSpent > 100000).length; // More than 100k
    const totalRevenue = clients.reduce((sum, c) => sum + c.totalSpent, 0);
    const averageOrderValue = totalClients > 0 ? totalRevenue / totalClients : 0;

    setStats({
      totalClients,
      activeClients,
      newClientsThisMonth,
      topSpenders,
      averageOrderValue,
      totalRevenue
    });
  };

  const filterClients = () => {
    let filtered = clients;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(client =>
        client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.phone.includes(searchTerm) ||
        client.business?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.email?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Location filter
    if (locationFilter !== 'all') {
      const [province, canton] = locationFilter.split('-');
      if (canton) {
        filtered = filtered.filter(client => 
          client.province === province && client.canton === canton
        );
      } else {
        filtered = filtered.filter(client => client.province === province);
      }
    }

    // Status filter
    if (statusFilter === 'active') {
      filtered = filtered.filter(client => client.isActive);
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter(client => !client.isActive);
    } else if (statusFilter === 'favorites') {
      filtered = filtered.filter(client => client.isFavorite);
    } else if (statusFilter === 'top-spenders') {
      filtered = filtered.filter(client => client.totalSpent > 100000);
    }

    setFilteredClients(filtered);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingClient ? '/api/config/automatic-clients' : '/api/config/automatic-clients';
      const method = editingClient ? 'PUT' : 'POST';
      const body = editingClient ? { id: editingClient.id, ...formData } : formData;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (response.ok) {
        await loadClients();
        setShowForm(false);
        setEditingClient(null);
        resetForm();
      }
    } catch (error) {
      console.error('Error saving client:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Está seguro de que desea eliminar este cliente?')) return;
    
    try {
      const response = await fetch(`/api/config/automatic-clients?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadClients();
      }
    } catch (error) {
      console.error('Error deleting client:', error);
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name,
      phone: client.phone,
      email: client.email || '',
      province: client.province,
      canton: client.canton,
      district: client.district,
      address: client.address || '',
      business: client.business || '',
      username: client.username || '',
      notes: client.notes || '',
      isFavorite: client.isFavorite
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      phone: '',
      email: '',
      province: '',
      canton: '',
      district: '',
      address: '',
      business: '',
      username: '',
      notes: '',
      isFavorite: false
    });
  };

  const getClientStatus = (client: Client) => {
    if (!client.isActive) return { status: 'inactive', color: 'bg-muted text-foreground', icon: EyeOff };
    if (client.isFavorite) return { status: 'favorite', color: 'bg-yellow-100 text-yellow-800', icon: Star };
    if (client.totalSpent > 100000) return { status: 'vip', color: 'bg-purple-100 text-purple-800', icon: TrendingUp };
    return { status: 'active', color: 'bg-green-100 text-green-800', icon: CheckCircle };
  };

  const getLocations = () => {
    const locations = new Set<string>();
    clients.forEach(client => {
      locations.add(`${client.province}-${client.canton}`);
      locations.add(client.province);
    });
    return Array.from(locations);
  };

  const syncClientsFromSales = async () => {
    try {
      const response = await fetch('/api/config/automatic-clients/sync', {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        await loadClients();
        alert('Clientes sincronizados exitosamente desde las ventas');
      }
    } catch (error) {
      console.error('Error syncing clients:', error);
      alert('Error al sincronizar clientes');
    }
  };

  if (userLoading || loading) {
    return <div className="p-4">Cargando clientes...</div>;
  }

  if (!user || user.role !== 'MASTER') {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground">
              Solo los usuarios MASTER pueden acceder a la gestión de clientes.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestión Automática de Clientes</h1>
          <p className="text-muted-foreground">Clientes sincronizados automáticamente desde las ventas</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={syncClientsFromSales}
            variant="outline"
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Sincronizar desde Ventas
          </Button>
          <Button
            onClick={() => {
              setEditingClient(null);
              resetForm();
              setShowForm(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Agregar Cliente
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Clientes</p>
                <p className="text-2xl font-bold">{stats.totalClients}</p>
              </div>
              <Users className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Clientes Activos</p>
                <p className="text-2xl font-bold text-green-600">{stats.activeClients}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Nuevos Este Mes</p>
                <p className="text-2xl font-bold text-blue-600">{stats.newClientsThisMonth}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Ingresos Totales</p>
                <p className="text-2xl font-bold text-green-600">₡{stats.totalRevenue.toLocaleString()}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar clientes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="px-3 py-2 border border-border rounded-md"
            >
              <option value="all">Todas las ubicaciones</option>
              {getLocations().map(location => (
                <option key={location} value={location}>
                  {location.includes('-') ? location.split('-')[1] : location}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-border rounded-md"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="favorites">Favoritos</option>
              <option value="top-spenders">Top Gastadores</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingClient ? 'Editar Cliente' : 'Agregar Cliente'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Nombre Completo</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="business">Negocio</Label>
                  <Input
                    id="business"
                    value={formData.business}
                    onChange={(e) => setFormData({ ...formData, business: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="province">Provincia</Label>
                  <Input
                    id="province"
                    value={formData.province}
                    onChange={(e) => setFormData({ ...formData, province: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="canton">Cantón</Label>
                  <Input
                    id="canton"
                    value={formData.canton}
                    onChange={(e) => setFormData({ ...formData, canton: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="district">Distrito</Label>
                  <Input
                    id="district"
                    value={formData.district}
                    onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="address">Dirección</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="username">Usuario</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="notes">Notas</Label>
                  <Input
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isFavorite"
                  checked={formData.isFavorite}
                  onChange={(e) => setFormData({ ...formData, isFavorite: e.target.checked })}
                />
                <Label htmlFor="isFavorite">Cliente Favorito</Label>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  {editingClient ? 'Actualizar' : 'Agregar'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingClient(null);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Clients List */}
      <div className="grid gap-4">
        {filteredClients.map((client) => {
          const clientStatus = getClientStatus(client);
          const StatusIcon = clientStatus.icon;
          
          return (
            <Card key={client.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold">{client.name}</h3>
                      {client.isFavorite && (
                        <Star className="h-4 w-4 text-yellow-500 fill-current" />
                      )}
                      <Badge className={clientStatus.color}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {clientStatus.status === 'inactive' ? 'Inactivo' : 
                         clientStatus.status === 'favorite' ? 'Favorito' :
                         clientStatus.status === 'vip' ? 'VIP' : 'Activo'}
                      </Badge>
                      <Badge variant="outline">{client.totalOrders} pedidos</Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {client.phone}
                      </div>
                      {client.email && (
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {client.email}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {client.province}, {client.canton}
                      </div>
                      {client.business && (
                        <div className="flex items-center gap-1">
                          <Building className="h-3 w-3" />
                          {client.business}
                        </div>
                      )}
                      <div>
                        <span className="font-medium">Total Gastado:</span> ₡{client.totalSpent.toLocaleString()}
                      </div>
                      <div>
                        <span className="font-medium">Promedio por Pedido:</span> ₡{client.averageOrderValue.toLocaleString()}
                      </div>
                      <div>
                        <span className="font-medium">Último Pedido:</span> {new Date(client.lastOrder).toLocaleDateString()}
                      </div>
                      <div>
                        <span className="font-medium">Primer Pedido:</span> {new Date(client.firstOrder).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(client)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(client.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredClients.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No hay clientes registrados</p>
            <div className="flex gap-2 justify-center mt-4">
              <Button
                onClick={syncClientsFromSales}
                variant="outline"
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Sincronizar desde Ventas
              </Button>
              <Button
                onClick={() => {
                  setEditingClient(null);
                  resetForm();
                  setShowForm(true);
                }}
              >
                Agregar Primer Cliente
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
