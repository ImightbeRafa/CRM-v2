'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Star, Plus, Edit, Trash2, Users, Package, Settings, BarChart3, Truck } from 'lucide-react';
import { InventoryManagement } from './InventoryManagement';
import { AutomaticClientManagement } from './AutomaticClientManagement';
import { ShippingConfigManagement } from './ShippingConfigManagement';

interface FrequentProduct {
  id: string;
  name: string;
  type: string;
  color?: string;
  tamano?: string;
  baseCost: number;
  isFavorite: boolean;
  lastUsed: string;
  useCount: number;
  active: boolean;
}

interface FrequentCustomer {
  id: string;
  name: string;
  phone: string;
  province: string;
  canton: string;
  district: string;
  email?: string;
  username?: string;
  address?: string;
  business?: string;
  totalOrders: number;
  lastOrder: string;
  active: boolean;
}

interface MasterConfigDashboardProps {
  initialTab?: 'inventory' | 'clients' | 'shipping';
  lockToInitial?: boolean;
}

export function MasterConfigDashboard({ initialTab = 'inventory', lockToInitial = false }: MasterConfigDashboardProps = {}) {
  const [activeTab, setActiveTab] = useState<'inventory' | 'clients' | 'shipping'>(initialTab);
  const [products, setProducts] = useState<FrequentProduct[]>([]);
  const [customers, setCustomers] = useState<FrequentCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<FrequentProduct | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<FrequentCustomer | null>(null);

  // Product form state - use empty string for baseCost to allow easy clearing
  const [productForm, setProductForm] = useState({
    name: '',
    type: '',
    color: '',
    tamano: '',
    baseCost: '' as string | number,
    isFavorite: false
  });

  // Customer form state
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    province: '',
    canton: '',
    district: '',
    email: '',
    username: '',
    address: '',
    business: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [productsRes, customersRes] = await Promise.all([
        fetch('/api/config/frequent-products', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/config/frequent-customers', { credentials: 'include' }).then(r => r.json())
      ]);

      if (productsRes.status === 'success') {
        setProducts(productsRes.data);
      }
      if (customersRes.status === 'success') {
        setCustomers(customersRes.data);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingProduct ? '/api/config/frequent-products' : '/api/config/frequent-products';
      const method = editingProduct ? 'PUT' : 'POST';
      const body = editingProduct ? { id: editingProduct.id, ...productForm } : productForm;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (response.ok) {
        await loadData();
        setShowProductForm(false);
        setEditingProduct(null);
        setProductForm({ name: '', type: '', color: '', tamano: '', baseCost: 0, isFavorite: false });
      }
    } catch (error) {
      console.error('Error saving product:', error);
    }
  };

  const handleCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingCustomer ? '/api/config/frequent-customers' : '/api/config/frequent-customers';
      const method = editingCustomer ? 'PUT' : 'POST';
      const body = editingCustomer ? { id: editingCustomer.id, ...customerForm } : customerForm;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (response.ok) {
        await loadData();
        setShowCustomerForm(false);
        setEditingCustomer(null);
        setCustomerForm({ name: '', phone: '', province: '', canton: '', district: '', email: '', username: '', address: '', business: '' });
      }
    } catch (error) {
      console.error('Error saving customer:', error);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('¿Está seguro de que desea eliminar este producto frecuente?')) return;
    
    try {
      const response = await fetch(`/api/config/frequent-products?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm('¿Está seguro de que desea eliminar este cliente frecuente?')) return;
    
    try {
      const response = await fetch(`/api/config/frequent-customers?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadData();
      }
    } catch (error) {
      console.error('Error deleting customer:', error);
    }
  };

  const handleEditProduct = (product: FrequentProduct) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      type: product.type,
      color: product.color || '',
      tamano: product.tamano || '',
      baseCost: product.baseCost,
      isFavorite: product.isFavorite
    });
    setShowProductForm(true);
  };

  const handleEditCustomer = (customer: FrequentCustomer) => {
    setEditingCustomer(customer);
    setCustomerForm({
      name: customer.name,
      phone: customer.phone,
      province: customer.province,
      canton: customer.canton,
      district: customer.district,
      email: customer.email || '',
      username: customer.username || '',
      address: customer.address || '',
      business: customer.business || ''
    });
    setShowCustomerForm(true);
  };

  if (loading) {
    return <div className="p-4">Cargando...</div>;
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Gestión Avanzada</h1>
        {!lockToInitial && (
          <div className="flex gap-2">
            <Button
              variant={activeTab === 'inventory' ? 'default' : 'outline'}
              onClick={() => setActiveTab('inventory')}
              className="flex items-center gap-2"
            >
              <Package className="h-4 w-4" />
              Inventario
            </Button>
            <Button
              variant={activeTab === 'clients' ? 'default' : 'outline'}
              onClick={() => setActiveTab('clients')}
              className="flex items-center gap-2"
            >
              <Users className="h-4 w-4" />
              Clientes Automáticos
            </Button>
            <Button
              variant={activeTab === 'shipping' ? 'default' : 'outline'}
              onClick={() => setActiveTab('shipping')}
              className="flex items-center gap-2"
            >
              <Truck className="h-4 w-4" />
              Configuración de Envíos
            </Button>
          </div>
        )}
      </div>

      {activeTab === 'inventory' && (
        <InventoryManagement />
      )}

      {activeTab === 'clients' && (
        <AutomaticClientManagement />
      )}

      {activeTab === 'shipping' && (
        <ShippingConfigManagement />
      )}

      {/* Legacy code for backward compatibility - removed products tab */}
      {false && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Productos Recurrentes</h2>
            <Button
              onClick={() => {
                setEditingProduct(null);
                setProductForm({ name: '', type: '', color: '', tamano: '', baseCost: 0, isFavorite: false });
                setShowProductForm(true);
              }}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Agregar Producto
            </Button>
          </div>

          {showProductForm && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingProduct ? 'Editar Producto' : 'Agregar Producto Frecuente'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleProductSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name">Nombre</Label>
                      <Input
                        id="name"
                        value={productForm.name}
                        onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="type">Tipo</Label>
                      <Input
                        id="type"
                        value={productForm.type}
                        onChange={(e) => setProductForm({ ...productForm, type: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="color">Color</Label>
                      <Input
                        id="color"
                        value={productForm.color}
                        onChange={(e) => setProductForm({ ...productForm, color: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="tamano">Tamaño</Label>
                      <Input
                        id="tamano"
                        value={productForm.tamano}
                        onChange={(e) => setProductForm({ ...productForm, tamano: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="baseCost">Costo Base</Label>
                      <Input
                        id="baseCost"
                        type="number"
                        step="0.01"
                        value={productForm.baseCost}
                        onChange={(e) => setProductForm({ ...productForm, baseCost: e.target.value })}
                        onBlur={(e) => {
                          if (e.target.value === '') {
                            setProductForm({ ...productForm, baseCost: 0 });
                          }
                        }}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="isFavorite"
                        checked={productForm.isFavorite}
                        onChange={(e) => setProductForm({ ...productForm, isFavorite: e.target.checked })}
                      />
                      <Label htmlFor="isFavorite">Favorito</Label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit">
                      {editingProduct ? 'Actualizar' : 'Agregar'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowProductForm(false);
                        setEditingProduct(null);
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {products.map((product) => (
              <Card key={product.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{product.name}</h3>
                        {product.isFavorite && (
                          <Star className="h-4 w-4 text-yellow-500 fill-current" />
                        )}
                        <Badge variant="outline">{product.type}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {product.color && `${product.color} • `}
                        {product.tamano && `${product.tamano} • `}
                        ₡{product.baseCost.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Usado {product.useCount} veces • Último uso: {new Date(product.lastUsed).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEditProduct(product)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteProduct(product.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {false && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Clientes Recurrentes</h2>
            <Button
              onClick={() => {
                setEditingCustomer(null);
                setCustomerForm({ name: '', phone: '', province: '', canton: '', district: '', email: '', username: '', address: '', business: '' });
                setShowCustomerForm(true);
              }}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Agregar Cliente
            </Button>
          </div>

          {showCustomerForm && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingCustomer ? 'Editar Cliente' : 'Agregar Cliente Frecuente'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCustomerSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="customerName">Nombre</Label>
                      <Input
                        id="customerName"
                        value={customerForm.name}
                        onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone">Teléfono</Label>
                      <Input
                        id="phone"
                        value={customerForm.phone}
                        onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="province">Provincia</Label>
                      <Input
                        id="province"
                        value={customerForm.province}
                        onChange={(e) => setCustomerForm({ ...customerForm, province: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="canton">Cantón</Label>
                      <Input
                        id="canton"
                        value={customerForm.canton}
                        onChange={(e) => setCustomerForm({ ...customerForm, canton: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="district">Distrito</Label>
                      <Input
                        id="district"
                        value={customerForm.district}
                        onChange={(e) => setCustomerForm({ ...customerForm, district: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={customerForm.email}
                        onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="username">Usuario</Label>
                      <Input
                        id="username"
                        value={customerForm.username}
                        onChange={(e) => setCustomerForm({ ...customerForm, username: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="address">Dirección</Label>
                      <Input
                        id="address"
                        value={customerForm.address}
                        onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="business">Negocio</Label>
                      <Input
                        id="business"
                        value={customerForm.business}
                        onChange={(e) => setCustomerForm({ ...customerForm, business: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit">
                      {editingCustomer ? 'Actualizar' : 'Agregar'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowCustomerForm(false);
                        setEditingCustomer(null);
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {customers.map((customer) => (
              <Card key={customer.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{customer.name}</h3>
                        <Badge variant="outline">{customer.totalOrders} pedidos</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {customer.phone} • {customer.province}, {customer.canton}, {customer.district}
                      </p>
                      {customer.email && (
                        <p className="text-sm text-muted-foreground">{customer.email}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Último pedido: {new Date(customer.lastOrder).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEditCustomer(customer)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteCustomer(customer.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
