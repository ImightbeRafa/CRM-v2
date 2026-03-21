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
  const [testResult, setTestResult] = useState<string>('');
  const [testing, setTesting] = useState(false);

  // Get the current domain for API endpoint URL
  const apiBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';

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

  const testConnection = async () => {
    setTesting(true);
    setTestResult('');

    try {
      const response = await fetch('/api/integration/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          test: true,
          timestamp: new Date().toISOString(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTestResult(`✅ Conexión exitosa! El endpoint está funcionando correctamente.\n\nRespuesta: ${JSON.stringify(data, null, 2)}`);
      } else {
        setTestResult(`❌ Error: ${data.error || 'Unknown error'}\n\nDetalles: ${JSON.stringify(data, null, 2)}`);
      }
    } catch (error) {
      setTestResult(`❌ Error de conexión: ${error instanceof Error ? error.message : 'Unknown error'}\n\nNo se pudo conectar al endpoint. Verifica que el servidor esté funcionando.`);
    } finally {
      setTesting(false);
    }
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
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Configuración
        </a>
      </div>

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Integraciones de Sitio Web</h1>
          <p className="text-muted-foreground">
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
                  <p className="text-sm text-muted-foreground">Pedidos Recibidos</p>
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
                  <p className="text-sm text-muted-foreground">Errores</p>
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
                  <p className="text-sm text-muted-foreground">Último Pedido</p>
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
                  <p className="text-sm text-muted-foreground">API Keys Activas</p>
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
              <div className="flex items-center gap-2 p-2 bg-card rounded border">
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
            <div className="text-center py-8 text-muted-foreground">
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
                    <div className="text-sm text-muted-foreground mt-1">
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

      {/* Test Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Probar Conexión
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Verifica que el endpoint de integración esté funcionando correctamente.
          </p>
          <div className="flex items-center gap-4">
            <Button
              onClick={testConnection}
              disabled={testing}
              className="flex items-center gap-2"
            >
              <Activity className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Probando...' : 'Probar Conexión'}
            </Button>
            {testResult && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(testResult)}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copiar Resultado
              </Button>
            )}
          </div>
          {testResult && (
            <pre className="bg-muted p-4 rounded text-xs overflow-x-auto whitespace-pre-wrap">
              {testResult}
            </pre>
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
        <CardContent className="space-y-6">
          <div className="prose max-w-none">
            {/* Endpoint URL */}
            <h4 className="text-lg font-semibold">URL del Endpoint:</h4>
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
              <code className="flex-1 text-sm font-mono text-blue-900">
                POST {apiBaseUrl}/api/integration/orders/create
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copyToClipboard(`${apiBaseUrl}/api/integration/orders/create`)}
                className="text-blue-600 hover:text-blue-700"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>

            {/* Setup Steps */}
            <h4 className="text-lg font-semibold">Cómo conectar tu sitio web:</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Crea una API Key usando el botón &quot;Nueva API Key&quot;</li>
              <li>Guarda la clave de forma segura en las variables de entorno de tu sitio</li>
              <li>Configura tu sitio para enviar pedidos con <code className="bg-muted px-2 py-1 rounded">Content-Type: application/json</code></li>
              <li>Incluye la API Key en el header: <code className="bg-muted px-2 py-1 rounded">x-api-key: tu-api-key-aqui</code></li>
            </ol>

            {/* Request Headers */}
            <h4 className="text-lg font-semibold mt-6">Headers requeridos:</h4>
            <div className="bg-muted p-4 rounded text-xs overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1 pr-4">Header</th>
                    <th className="py-1 pr-4">Requerido</th>
                    <th className="py-1">Descripción</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-1 pr-4 font-mono">Content-Type</td>
                    <td className="py-1 pr-4">✅ Sí</td>
                    <td className="py-1">application/json</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-4 font-mono">x-api-key</td>
                    <td className="py-1 pr-4">✅ Sí</td>
                    <td className="py-1">Tu API key de Betsy (empieza con bts_)</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Request Body */}
            <h4 className="text-lg font-semibold mt-6">Formato del body (JSON):</h4>
            <p className="text-sm text-muted-foreground mb-2">
              Todos los campos son <strong>requeridos</strong> salvo los marcados como <em>// opcional</em>.
            </p>
            <pre className="bg-muted p-4 rounded text-xs overflow-x-auto">
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
    "courier": "Correos de Costa Rica",       // opcional
    "address": {
      "province": "San José",
      "canton": "Escazú",
      "district": "San Rafael",
      "fullAddress": "Condominio Riverside Edificio B Apto 604"
    }
  },
  "total": "₡9.900",
  "payment": {
    "method": "Tilopay",
    "transactionId": "3739128",
    "status": "PAGADO",
    "date": "12/11/2025, 8:33:00 p.m."
  },
  "source": "mi-tienda-online.com",            // opcional - identifica tu sitio
  "salesChannel": "Website",                   // opcional - canal de venta
  "seller": "Ana López",                       // opcional - vendedor asignado
  "metadata": {                                // opcional - datos adicionales
    "comments": "Entregar después de las 5pm", // se guarda como comentario del pedido
    "cualquierCampo": "cualquier valor"
  }
}`}
            </pre>

            {/* Field Reference */}
            <h4 className="text-lg font-semibold mt-6">Referencia de campos:</h4>
            <div className="bg-muted p-4 rounded text-xs overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1 pr-4">Campo</th>
                    <th className="py-1 pr-4">Tipo</th>
                    <th className="py-1 pr-4">Req.</th>
                    <th className="py-1">Nota</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr><td className="py-1 pr-4 font-mono">orderId</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">ID único de tu sistema</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">customer.name</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Nombre del cliente</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">customer.phone</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Teléfono del cliente</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">customer.email</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Email válido del cliente</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">product.name</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Nombre del producto</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">product.quantity</td><td className="py-1 pr-4">number</td><td className="py-1 pr-4">✅</td><td className="py-1">Debe ser positivo</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">product.unitPrice</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Acepta &quot;₡9.900&quot; o &quot;GRATIS&quot;</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">shipping.cost</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Acepta &quot;GRATIS&quot; para envío gratis</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">shipping.courier</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">❌</td><td className="py-1">Nombre del courier</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">shipping.address.*</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">province, canton, district, fullAddress</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">total</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Total del pedido (ej: &quot;₡9.900&quot;)</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">payment.method</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Método de pago</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">payment.transactionId</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">ID de transacción</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">payment.status</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Estado del pago</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">payment.date</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">✅</td><td className="py-1">Fecha del pago</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">source</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">❌</td><td className="py-1">Nombre/URL de tu sitio</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">salesChannel</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">❌</td><td className="py-1">Canal de venta</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">seller</td><td className="py-1 pr-4">string</td><td className="py-1 pr-4">❌</td><td className="py-1">Vendedor asignado</td></tr>
                  <tr><td className="py-1 pr-4 font-mono">metadata</td><td className="py-1 pr-4">object</td><td className="py-1 pr-4">❌</td><td className="py-1">metadata.comments se guarda como comentario</td></tr>
                </tbody>
              </table>
            </div>

            {/* Response Formats */}
            <h4 className="text-lg font-semibold mt-6">Respuestas del API:</h4>

            <p className="text-sm font-medium text-green-700 mt-3 mb-1">✅ Éxito (200)</p>
            <pre className="bg-green-50 border border-green-200 p-3 rounded text-xs overflow-x-auto">
              {`{
  "success": true,
  "message": "Order created successfully",
  "crmOrderId": "clxyz123abc",
  "orderId": "799360",
  "processingTime": 245
}`}
            </pre>

            <p className="text-sm font-medium text-red-700 mt-3 mb-1">❌ Error de validación (400)</p>
            <pre className="bg-red-50 border border-red-200 p-3 rounded text-xs overflow-x-auto">
              {`{
  "error": "Invalid order data",
  "details": [
    { "code": "invalid_type", "path": ["customer", "email"], "message": "Invalid email" }
  ]
}`}
            </pre>

            <p className="text-sm font-medium text-red-700 mt-3 mb-1">🔑 Error de autenticación (401)</p>
            <pre className="bg-red-50 border border-red-200 p-3 rounded text-xs overflow-x-auto">
              {`{ "error": "Missing API key. Include x-api-key header." }
// o
{ "error": "Invalid API key" }`}
            </pre>

            <p className="text-sm font-medium text-yellow-700 mt-3 mb-1">⚠️ Pedido duplicado (409)</p>
            <pre className="bg-yellow-50 border border-yellow-200 p-3 rounded text-xs overflow-x-auto">
              {`{ "error": "Order already exists", "orderId": "799360" }`}
            </pre>

            <p className="text-sm font-medium text-red-700 mt-3 mb-1">💥 Error del servidor (500)</p>
            <pre className="bg-red-50 border border-red-200 p-3 rounded text-xs overflow-x-auto">
              {`{ "error": "Internal server error", "message": "...", "processingTime": 150 }`}
            </pre>

            {/* cURL Example */}
            <h4 className="text-lg font-semibold mt-6">Ejemplo con cURL:</h4>
            <pre className="bg-gray-900 dark:bg-gray-950 text-green-400 p-4 rounded text-xs overflow-x-auto">
              {`curl -X POST ${apiBaseUrl}/api/integration/orders/create \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: bts_tu_api_key_aqui" \\
  -d '{
    "orderId": "799360",
    "customer": { "name": "Ian Kupfer", "phone": "88390944", "email": "ian@example.com" },
    "product": { "name": "Producto", "quantity": 1, "unitPrice": "₡9.900" },
    "shipping": {
      "cost": "GRATIS",
      "address": { "province": "San José", "canton": "Escazú", "district": "San Rafael", "fullAddress": "Dirección completa" }
    },
    "total": "₡9.900",
    "payment": { "method": "Tilopay", "transactionId": "123", "status": "PAGADO", "date": "14/02/2026" }
  }'`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
