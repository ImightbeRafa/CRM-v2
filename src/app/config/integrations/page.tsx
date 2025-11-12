'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { 
  Key, 
  Plus, 
  Copy, 
  Trash2, 
  Eye, 
  EyeOff, 
  ExternalLink,
  Activity,
  AlertCircle,
  CheckCircle,
  Globe,
  ArrowLeft
} from 'lucide-react';
import { Alert, AlertDescription } from '@/app/components/ui/alert';

interface ApiKey {
  id: string;
  name: string;
  active: boolean;
  lastUsed?: string;
  createdAt: string;
}

interface IntegrationStats {
  totalOrders: number;
  errorCount: number;
  lastOrderDate?: string;
  lastErrorDate?: string;
}

export default function IntegrationsPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [stats, setStats] = useState<IntegrationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [showKey, setShowKey] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [keysResponse, statsResponse] = await Promise.all([
        fetch('/api/config/api-keys'),
        fetch('/api/config/integration-stats')
      ]);

      if (keysResponse.ok) {
        const keysData = await keysResponse.json();
        setApiKeys(keysData.data || []);
      }

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData.data || null);
      }
    } catch (error) {
      console.error('Error loading integration data:', error);
    } finally {
      setLoading(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const response = await fetch('/api/config/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });

      if (response.ok) {
        const result = await response.json();
        setNewApiKey(result.apiKey);
        setNewKeyName('');
        setShowNewKeyDialog(false);
        loadData();
      }
    } catch (error) {
      console.error('Error creating API key:', error);
    }
  };

  const revokeApiKey = async (keyId: string) => {
    if (!confirm('¿Estás seguro de que quieres revocar esta API key? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
      const response = await fetch(`/api/config/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadData();
      }
    } catch (error) {
      console.error('Error revoking API key:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return <div className="p-6">Cargando...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back Button */}
      <div className="mb-4">
        <a
          href="/config?tab=integrations"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Configuración
        </a>
      </div>

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Integraciones de Sitio Web</h1>
          <p className="text-gray-600">
            Conecta tu sitio web para enviar pedidos automáticamente a Betsy CRM
          </p>
        </div>
        <Button onClick={() => setShowNewKeyDialog(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nueva API Key
        </Button>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm text-gray-600">Pedidos Recibidos</p>
                  <p className="text-2xl font-bold">{stats.totalOrders}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-sm text-gray-600">Errores</p>
                  <p className="text-2xl font-bold">{stats.errorCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm text-gray-600">Último Pedido</p>
                  <p className="text-sm font-medium">
                    {stats.lastOrderDate ? formatDate(stats.lastOrderDate) : 'Nunca'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-purple-500" />
                <div>
                  <p className="text-sm text-gray-600">API Keys Activas</p>
                  <p className="text-2xl font-bold">
                    {apiKeys.filter(k => k.active).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* New API Key Dialog */}
      {showNewKeyDialog && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Crear Nueva API Key
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Nombre de la API Key
              </label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="ej: Mi Sitio Web, Tienda Online..."
                className="max-w-md"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={createApiKey} disabled={!newKeyName.trim()}>
                Crear API Key
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowNewKeyDialog(false)}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* New API Key Display */}
      {newApiKey && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription>
            <div className="space-y-3">
              <p className="font-medium text-green-800">
                ¡API Key creada exitosamente!
              </p>
              <p className="text-sm text-green-700">
                Guarda esta clave de forma segura. No podrás verla nuevamente.
              </p>
              <div className="flex items-center gap-2 p-2 bg-white rounded border">
                <code className="flex-1 text-sm font-mono">
                  {showKey === 'new' ? newApiKey : '•'.repeat(40)}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowKey(showKey === 'new' ? null : 'new')}
                >
                  {showKey === 'new' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(newApiKey)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNewApiKey('')}
              >
                Entendido
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* API Keys List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Keys
          </CardTitle>
        </CardHeader>
        <CardContent>
          {apiKeys.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No tienes API keys creadas</p>
              <p className="text-sm">Crea una para conectar tu sitio web</p>
            </div>
          ) : (
            <div className="space-y-4">
              {apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium">{key.name}</h3>
                      <Badge variant={key.active ? "default" : "secondary"}>
                        {key.active ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Creada: {formatDate(key.createdAt)}
                      {key.lastUsed && (
                        <span className="ml-4">
                          Último uso: {formatDate(key.lastUsed)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revokeApiKey(key.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Integration Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Instrucciones de Integración
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="prose max-w-none">
            <h4 className="text-lg font-semibold">Cómo conectar tu sitio web:</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Crea una API Key usando el botón "Nueva API Key"</li>
              <li>Guarda la clave de forma segura en las variables de entorno de tu sitio</li>
              <li>Configura tu sitio para enviar pedidos a: <code className="bg-gray-100 px-2 py-1 rounded">POST /api/integration/orders/create</code></li>
              <li>Incluye la API Key en el header: <code className="bg-gray-100 px-2 py-1 rounded">x-api-key</code></li>
            </ol>
            
            <h4 className="text-lg font-semibold mt-6">Formato de datos requerido:</h4>
            <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
{`{
  "orderId": "799360",
  "customer": {
    "name": "Ian Kupfer",
    "phone": "88390944",
    "email": "iankuper506@gmail.com"
  },
  "product": {
    "name": "DeepSleep Bucal Anti-Ronquidos",
    "quantity": 1,
    "unitPrice": "₡9.900"
  },
  "shipping": {
    "cost": "GRATIS",
    "address": {
      "province": "San José",
      "canton": "Escazú",
      "district": "San Rafael",
      "fullAddress": "Condominio Riverside Edificio B Apto 604"
    }
  },
  "total": "₡9 900",
  "payment": {
    "method": "Tilopay",
    "transactionId": "3739128",
    "status": "PAGADO",
    "date": "12/11/2025, 8:33:00 p.m."
  }
}`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
