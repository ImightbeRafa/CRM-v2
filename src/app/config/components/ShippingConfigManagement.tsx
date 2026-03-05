'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Checkbox } from '@/app/components/ui/checkbox';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Truck, 
  CheckCircle,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';

interface ShippingConfig {
  id: string;
  carrier: string;
  name: string;
  email?: string;
  password?: string;
  apiKey?: string;
  baseUrl?: string;
  isActive: boolean;
  isDefault: boolean;
  settings?: any;
  createdAt: string;
  updatedAt: string;
}

export function ShippingConfigManagement() {
  const { user, loading: userLoading } = useCurrentUser();
  const [configs, setConfigs] = useState<ShippingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ShippingConfig | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    carrier: '',
    name: '',
    email: '',
    password: '',
    apiKey: '',
    baseUrl: '',
    isDefault: false,
    settings: {} as Record<string, any>,
  });

  const isCorreos = formData.carrier.toLowerCase() === 'correos_cr';

  const updateSetting = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/config/shipping-config', {
        credentials: 'include'
      });
      const result = await response.json();
      
      if (result.status === 'success') {
        setConfigs(result.data);
      }
    } catch (error) {
      console.error('Error loading shipping configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingConfig ? '/api/config/shipping-config' : '/api/config/shipping-config';
      const method = editingConfig ? 'PUT' : 'POST';
      const body = editingConfig ? { id: editingConfig.id, ...formData } : formData;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (response.ok) {
        await loadConfigs();
        setShowForm(false);
        setEditingConfig(null);
        setFormData({
          carrier: '',
          name: '',
          email: '',
          password: '',
          apiKey: '',
          baseUrl: '',
          isDefault: false,
          settings: {}
        });
      }
    } catch (error) {
      console.error('Error saving shipping config:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Está seguro de que desea eliminar esta configuración de envío?')) return;
    
    try {
      const response = await fetch(`/api/config/shipping-config?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadConfigs();
      }
    } catch (error) {
      console.error('Error deleting shipping config:', error);
    }
  };

  const handleEdit = (config: ShippingConfig) => {
    setEditingConfig(config);
    setFormData({
      carrier: config.carrier,
      name: config.name,
      email: config.email || '',
      password: '',
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || '',
      isDefault: config.isDefault,
      settings: config.settings || {},
    });
    setShowForm(true);
  };

  const getCarrierIcon = (carrier: string) => {
    switch (carrier.toLowerCase()) {
      case 'correos_cr':
        return '🇨🇷';
      case 'dhl':
        return '📦';
      case 'fedex':
        return '🚚';
      case 'ups':
        return '📦';
      default:
        return '🚛';
    }
  };

  const getCarrierName = (carrier: string) => {
    switch (carrier.toLowerCase()) {
      case 'correos_cr':
        return 'Correos de Costa Rica';
      case 'dhl':
        return 'DHL';
      case 'fedex':
        return 'FedEx';
      case 'ups':
        return 'UPS';
      default:
        return carrier;
    }
  };

  if (userLoading || loading) {
    return <div className="p-4">Cargando configuraciones de envío...</div>;
  }

  if (!user || user.role !== 'MASTER') {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-gray-500">
              Solo los usuarios MASTER pueden acceder a la configuración de envíos.
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
          <h2 className="text-2xl font-bold">Configuración de Envíos</h2>
          <p className="text-gray-600">Gestiona las configuraciones de empresas de envío</p>
        </div>
        <Button
          onClick={() => {
            setEditingConfig(null);
            setFormData({
              carrier: '',
              name: '',
              email: '',
              password: '',
              apiKey: '',
              baseUrl: '',
              isDefault: false,
              settings: {}
            });
            setShowForm(true);
          }}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Agregar Configuración
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingConfig ? 'Editar Configuración de Envío' : 'Nueva Configuración de Envío'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="carrier">Empresa de Envío</Label>
                  <Input
                    id="carrier"
                    value={formData.carrier}
                    onChange={(e) => setFormData({ ...formData, carrier: e.target.value })}
                    placeholder="correos_cr, dhl, fedex, etc."
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="name">Nombre para Mostrar</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Correos de Costa Rica"
                    required
                  />
                </div>
              </div>

              {isCorreos ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20 p-4 space-y-3">
                    <h4 className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">Credenciales Web Service (SOAP API)</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="ws_username">Username</Label>
                        <Input id="ws_username" value={formData.settings.ws_username || ''} onChange={(e) => updateSetting('ws_username', e.target.value)} placeholder="ccrWS..." />
                      </div>
                      <div>
                        <Label htmlFor="ws_password">Password {editingConfig && <span className="text-xs text-gray-400">(vacío = mantener)</span>}</Label>
                        <Input id="ws_password" type="password" value={formData.settings.ws_password || ''} onChange={(e) => updateSetting('ws_password', e.target.value)} placeholder={editingConfig ? '••••••••' : 'Password'} />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="ws_sistema">Sistema</Label>
                      <Input id="ws_sistema" value={formData.settings.ws_sistema || ''} onChange={(e) => updateSetting('ws_sistema', e.target.value)} placeholder="PYMEXPRESS" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label htmlFor="ws_usuario_id">Usuario ID</Label>
                        <Input id="ws_usuario_id" value={formData.settings.ws_usuario_id || ''} onChange={(e) => updateSetting('ws_usuario_id', e.target.value)} placeholder="117960921" />
                      </div>
                      <div>
                        <Label htmlFor="ws_servicio_id">Servicio ID</Label>
                        <Input id="ws_servicio_id" value={formData.settings.ws_servicio_id || ''} onChange={(e) => updateSetting('ws_servicio_id', e.target.value)} placeholder="1564" />
                      </div>
                      <div>
                        <Label htmlFor="ws_cod_cliente">Código Cliente</Label>
                        <Input id="ws_cod_cliente" value={formData.settings.ws_cod_cliente || ''} onChange={(e) => updateSetting('ws_cod_cliente', e.target.value)} placeholder="7362097" />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-4 space-y-3">
                    <h4 className="font-semibold text-sm text-amber-800 dark:text-amber-300">Datos del Remitente</h4>
                    <p className="text-xs text-gray-500">Información que aparece como remitente en cada guía generada</p>
                    <div>
                      <Label htmlFor="ws_sender_name">Nombre del Remitente</Label>
                      <Input id="ws_sender_name" value={formData.settings.ws_sender_name || ''} onChange={(e) => updateSetting('ws_sender_name', e.target.value)} placeholder="Mi Empresa S.A." />
                    </div>
                    <div>
                      <Label htmlFor="ws_sender_address">Dirección del Remitente</Label>
                      <Input id="ws_sender_address" value={formData.settings.ws_sender_address || ''} onChange={(e) => updateSetting('ws_sender_address', e.target.value)} placeholder="Barrio Los Yoses, San Pedro, San José" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="ws_sender_zip">Código Postal</Label>
                        <Input id="ws_sender_zip" value={formData.settings.ws_sender_zip || ''} onChange={(e) => updateSetting('ws_sender_zip', e.target.value)} placeholder="10107" />
                      </div>
                      <div>
                        <Label htmlFor="ws_sender_phone">Teléfono</Label>
                        <Input id="ws_sender_phone" value={formData.settings.ws_sender_phone || ''} onChange={(e) => updateSetting('ws_sender_phone', e.target.value)} placeholder="22345678" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="email">Email de Acceso</Label>
                    <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="usuario@ejemplo.com" />
                  </div>
                  <div>
                    <Label htmlFor="password">Contraseña</Label>
                    <Input id="password" type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="Contraseña de acceso" />
                  </div>
                  <div>
                    <Label htmlFor="apiKey">API Key (Opcional)</Label>
                    <Input id="apiKey" value={formData.apiKey} onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })} placeholder="API Key si está disponible" />
                  </div>
                  <div>
                    <Label htmlFor="baseUrl">URL Base</Label>
                    <Input id="baseUrl" value={formData.baseUrl} onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })} placeholder="https://api.example.com" />
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isDefault"
                  checked={formData.isDefault}
                  onCheckedChange={(checked) => setFormData({ ...formData, isDefault: !!checked })}
                />
                <Label htmlFor="isDefault">Configuración por Defecto</Label>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  {editingConfig ? 'Actualizar' : 'Crear'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingConfig(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Configurations List */}
      <div className="grid gap-4">
        {configs.map((config) => (
          <Card key={config.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{getCarrierIcon(config.carrier)}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{config.name}</h3>
                        {config.isDefault && (
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Por Defecto
                          </Badge>
                        )}
                        <Badge variant="outline">{getCarrierName(config.carrier)}</Badge>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        {config.carrier.toLowerCase() === 'correos_cr' && config.settings ? (
                          <>
                            {config.settings.ws_username && <p>🔗 WS: {config.settings.ws_username}</p>}
                            {config.settings.ws_sender_name && <p>📦 Remitente: {config.settings.ws_sender_name}</p>}
                            {config.settings.ws_sender_phone && <p>📞 {config.settings.ws_sender_phone}</p>}
                            {config.settings.ws_password && <p>🔒 Credenciales WS configuradas</p>}
                          </>
                        ) : (
                          <>
                            {config.email && <p>📧 {config.email}</p>}
                            {config.baseUrl && <p>🌐 {config.baseUrl}</p>}
                            {config.apiKey && <p>🔑 API Key configurada</p>}
                            {config.password && <p>🔒 Contraseña configurada</p>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(config)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(config.id)}
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

      {configs.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <Truck className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">
              No hay configuraciones de envío
            </h3>
            <p className="text-gray-500 mb-4">
              Agrega una configuración para automatizar la generación de guías de envío.
            </p>
            <Button
              onClick={() => {
                setEditingConfig(null);
                setFormData({
                  carrier: '',
                  name: '',
                  email: '',
                  password: '',
                  apiKey: '',
                  baseUrl: '',
                  isDefault: false,
                  settings: {}
                });
                setShowForm(true);
              }}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Agregar Primera Configuración
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
