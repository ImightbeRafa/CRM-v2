'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import { 
  Download, 
  FileText, 
  Table, 
  Database, 
  Users, 
  ShoppingCart,
  BarChart3,
  Calendar,
  Filter,
  Settings,
  CheckCircle,
  AlertTriangle,
  Info
} from 'lucide-react';

interface ExportOptions {
  format: 'json' | 'csv' | 'xlsx';
  startDate?: string;
  endDate?: string;
  status?: string;
  includeOrders?: boolean;
  includeStats?: boolean;
  includeUsers?: boolean;
  includeSystemData?: boolean;
  groupBy?: 'day' | 'week' | 'month' | 'year' | 'none';
}

export default function ExportDashboard() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleExport = async (type: string, options: ExportOptions) => {
    try {
      setLoading(type);
      setError(null);
      setSuccess(null);

      // Build query parameters
      const params = new URLSearchParams();
      params.append('format', options.format);
      
      if (options.startDate) params.append('startDate', options.startDate);
      if (options.endDate) params.append('endDate', options.endDate);
      if (options.status) params.append('status', options.status);
      if (options.includeOrders) params.append('includeOrders', 'true');
      if (options.includeStats) params.append('includeStats', 'true');
      if (options.includeUsers) params.append('includeUsers', 'true');
      if (options.includeSystemData) params.append('includeSystemData', 'true');
      if (options.groupBy) params.append('groupBy', options.groupBy);

      // Make API call
      const response = await fetch(`/api/exports/${type}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`No se pudo exportar (${response.status}).`);
      }

      // Get filename from response headers
      const contentDisposition = response.headers.get('content-disposition');
      const filename = contentDisposition 
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
        : `${type}-export.${options.format}`;

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccess(`${type} exported successfully as ${filename}`);
      setLoading(null);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar');
      setLoading(null);
    }
  };

  const ExportCard = ({ 
    title, 
    description, 
    icon, 
    type, 
    defaultOptions,
    advancedOptions = false 
  }: {
    title: string;
    description: string;
    icon: React.ReactNode;
    type: string;
    defaultOptions: ExportOptions;
    advancedOptions?: boolean;
  }) => {
    const [options, setOptions] = useState<ExportOptions>(defaultOptions);
    const [showAdvanced, setShowAdvanced] = useState(false);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {icon}
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Format Selection */}
          <div>
            <label className="text-sm font-medium">Formato</label>
            <div className="flex gap-2 mt-1">
              {['json', 'csv', 'xlsx'].map((format) => (
                <Button
                  key={format}
                  variant={options.format === format ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOptions({ ...options, format: format as any })}
                >
                  {format.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Desde</label>
              <input
                type="date"
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                value={options.startDate || ''}
                onChange={(e) => setOptions({ ...options, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Hasta</label>
              <input
                type="date"
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                value={options.endDate || ''}
                onChange={(e) => setOptions({ ...options, endDate: e.target.value })}
              />
            </div>
          </div>

          {/* Advanced Options */}
          {advancedOptions && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2"
              >
                <Settings className="h-4 w-4" />
                {showAdvanced ? 'Hide' : 'Show'} Advanced Options
              </Button>
              
              {showAdvanced && (
                <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-md">
                  {type === 'clients' && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={options.includeOrders || false}
                          onChange={(e) => setOptions({ ...options, includeOrders: e.target.checked })}
                        />
                        Incluir historial de pedidos
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={options.includeStats || false}
                          onChange={(e) => setOptions({ ...options, includeStats: e.target.checked })}
                        />
                        Incluir estadísticas
                      </label>
                    </div>
                  )}
                  
                  {type === 'sales' && (
                    <div>
                      <label className="text-sm font-medium">Agrupar por</label>
                      <select
                        className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md"
                        value={options.groupBy || 'none'}
                        onChange={(e) => setOptions({ ...options, groupBy: e.target.value as any })}
                      >
                        <option value="none">Sin agrupar</option>
                        <option value="day">Día</option>
                        <option value="week">Semana</option>
                        <option value="month">Mes</option>
                        <option value="year">Año</option>
                      </select>
                    </div>
                  )}
                  
                  {type === 'database' && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={options.includeUsers || false}
                          onChange={(e) => setOptions({ ...options, includeUsers: e.target.checked })}
                        />
                        Incluir usuarios
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={options.includeSystemData || false}
                          onChange={(e) => setOptions({ ...options, includeSystemData: e.target.checked })}
                        />
                        Incluir datos del sistema
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Export Button */}
          <Button
            onClick={() => handleExport(type, options)}
            disabled={loading === type}
            className="w-full flex items-center gap-2"
          >
            {loading === type ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Download className="h-4 w-4" />
            )}
            {loading === type ? 'Exportando…' : `Exportar ${title.toLowerCase()}`}
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Status Messages */}
      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {success && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Export Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Orders Export */}
        <ExportCard
          title="Pedidos"
          description="Pedidos con datos de cliente y vendedor"
          icon={<ShoppingCart className="h-5 w-5" />}
          type="orders"
          defaultOptions={{
            format: 'xlsx',
            startDate: '',
            endDate: '',
            status: ''
          }}
        />

        {/* Sales Export */}
        <ExportCard
          title="Ventas"
          description="Ventas con totales y agrupación por período"
          icon={<BarChart3 className="h-5 w-5" />}
          type="sales"
          defaultOptions={{
            format: 'xlsx',
            startDate: '',
            endDate: '',
            groupBy: 'day'
          }}
          advancedOptions={true}
        />

        {/* Clients Export */}
        <ExportCard
          title="Clientes"
          description="Clientes con historial de pedidos y estadísticas"
          icon={<Users className="h-5 w-5" />}
          type="clients"
          defaultOptions={{
            format: 'xlsx',
            startDate: '',
            endDate: '',
            includeOrders: false,
            includeStats: true
          }}
          advancedOptions={true}
        />

        {/* Database Export */}
        <ExportCard
          title="Base de datos"
          description="Base de datos completa (solo administradores)"
          icon={<Database className="h-5 w-5" />}
          type="database"
          defaultOptions={{
            format: 'json',
            startDate: '',
            endDate: '',
            includeUsers: false,
            includeSystemData: false
          }}
          advancedOptions={true}
        />
      </div>

      {/* Export Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Información
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">Formatos disponibles</h4>
              <div className="flex gap-2 mt-2">
                <Badge variant="outline">JSON</Badge>
                <Badge variant="outline">CSV</Badge>
                <Badge variant="outline">XLSX</Badge>
                <Badge variant="outline">SQL</Badge>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium">Seguridad</h4>
              <ul className="text-sm text-gray-600 mt-2 space-y-1">
                <li>• Cada exportación incluye solo los datos de tu negocio</li>
                <li>• Los datos de usuarios requieren permisos de administrador</li>
                <li>• Las exportaciones incluyen fechas y metadatos</li>
                <li>• Las exportaciones grandes pueden tardar varios minutos</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium">Consejos</h4>
              <ul className="text-sm text-gray-600 mt-2 space-y-1">
                <li>• Usá rangos de fechas para exportar menos datos</li>
                <li>• XLSX incluye varias hojas</li>
                <li>• CSV es el mejor para análisis</li>
                <li>• JSON conserva todas las relaciones de los datos</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
