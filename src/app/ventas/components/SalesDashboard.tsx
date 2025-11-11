import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import { useSalesStream } from '@/app/hooks/useSalesStream';
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, TrendingUp, Package, DollarSign, Clock } from 'lucide-react';

interface Sale {
  orderId: string;
  status: string;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  product: string;
  total: number;
  timestamp: string;
  orderType: 'EA' | 'RA';
}

export const SalesDashboard = React.memo(function SalesDashboard() {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [orderTypeFilter, setOrderTypeFilter] = useState<'ALL' | 'EA' | 'RA'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const { formatCurrency } = useTenantSettings();

  const { sales, isLoading, error, refresh, stats } = useSalesStream({
    pollingInterval: 30000 // 30 seconds
  });

  const filteredSales = sales
    .filter(sale => {
      const matchesOrderType = orderTypeFilter === 'ALL' || sale.orderType === orderTypeFilter;
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        (sale.customerName || '').toLowerCase().includes(searchLower) ||
        (sale.orderId || '').toLowerCase().includes(searchLower) ||
        (sale.phone || '').includes(searchTerm);
      return matchesOrderType && matchesSearch;
    })
    .slice(0, 10);

  // Calculate average order value
  const averageOrderValue = stats && stats.total > 0 
    ? stats.totalAmount / stats.total 
    : 0;

  return (
    <div className="space-y-4" style={{ zIndex: 1, position: 'relative' }}>
      {/* Quick Stats Summary */}
      {!isLoading && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Ventas</p>
                  <p className="text-lg font-bold">{formatCurrency(stats.totalAmount || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Package className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Órdenes</p>
                  <p className="text-lg font-bold">{stats.total || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Promedio</p>
                  <p className="text-lg font-bold">₡{Math.round(averageOrderValue).toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-l-4 border-l-orange-500">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Clock className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Esta Semana</p>
                  <p className="text-lg font-bold">{sales.filter(s => {
                    const saleDate = new Date(s.timestamp);
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    return saleDate >= weekAgo;
                  }).length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg font-semibold">Historial de Ventas</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Últimas 10 órdenes • {filteredSales.length} {filteredSales.length === 1 ? 'resultado' : 'resultados'}
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={refresh}
              disabled={isLoading}
              className="gap-2 relative z-10"
              style={{ position: 'relative', zIndex: 10 }}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLoading ? 'Actualizando...' : 'Actualizar'}
            </Button>
          </div>
          <div className="flex gap-2 mt-3">
            <Select
              value={orderTypeFilter}
              onValueChange={(value: 'ALL' | 'EA' | 'RA') => setOrderTypeFilter(value)}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">📦 Todas</SelectItem>
                <SelectItem value="EA">🚚 Envíos</SelectItem>
                <SelectItem value="RA">🏪 Retiros</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="🔍 Buscar por nombre, orden o teléfono..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table className="relative">
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="font-semibold">Orden</TableHead>
                  <TableHead className="font-semibold">Cliente</TableHead>
                  <TableHead className="font-semibold">Producto</TableHead>
                  <TableHead className="font-semibold">Total</TableHead>
                  <TableHead className="font-semibold">Estado</TableHead>
                  <TableHead className="font-semibold">Tiempo</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8">
                      <div className="flex justify-center items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Cargando ventas...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-red-500 py-8">
                      {error}
                    </TableCell>
                  </TableRow>
                ) : filteredSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      No se encontraron ventas
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSales.map((sale) => (
                    <TableRow key={sale.orderId} className="hover:bg-gray-50 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-2 relative z-10" style={{ position: 'relative', zIndex: 10 }}>
                          <span className="relative z-10 font-mono text-sm">{sale.orderId}</span>
                          <Badge 
                            variant={sale.orderType === 'EA' ? 'default' : 'secondary'} 
                            className="relative z-10 text-xs"
                          >
                            {sale.orderType === 'EA' ? '🚚 EA' : '🏪 RA'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium text-gray-900">{sale.customerName}</div>
                          <div className="text-xs text-muted-foreground">📞 {sale.phone}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-700 max-w-[200px] truncate" title={sale.product}>
                          {sale.product}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-bold text-green-600">
                          ₡{sale.total.toLocaleString()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={
                            sale.status === 'Pendiente' ? 'warning' :
                            sale.status === 'Completado' ? 'success' : 'default'
                          }
                          className="font-medium"
                        >
                          {sale.status === 'Pendiente' ? '⏳' : 
                           sale.status === 'Completado' ? '✅' : '📋'} {sale.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {(() => {
                          const date = new Date(sale.timestamp);
                          return isNaN(date.getTime()) 
                            ? 'Fecha inválida'
                            : formatDistanceToNow(date, { 
                                addSuffix: true,
                                locale: es 
                              });
                        })()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSale(sale)}
                          className="hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        >
                          👁️ Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSale} onOpenChange={() => setSelectedSale(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-3">
                <span className="text-xl">📋 Detalles de Orden</span>
                {selectedSale && (
                  <Badge 
                    variant={selectedSale.orderType === 'EA' ? 'default' : 'secondary'}
                    className="text-sm"
                  >
                    {selectedSale.orderType === 'EA' ? '🚚 Envío' : '🏪 Retiro'}
                  </Badge>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-4">
              {/* Order ID Card */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <p className="text-xs text-blue-600 font-semibold mb-1">ID DE ORDEN</p>
                <p className="text-lg font-mono font-bold text-blue-900">{selectedSale.orderId}</p>
              </div>

              {/* Customer Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">👤 Cliente</h4>
                  <p className="font-medium text-gray-900">{selectedSale.customerName}</p>
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">📞 Teléfono</h4>
                  <p className="font-medium text-gray-900">{selectedSale.phone}</p>
                </div>
                <div className="space-y-1 col-span-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">📧 Email</h4>
                  <p className="font-medium text-gray-900">{selectedSale.email || 'No especificado'}</p>
                </div>
              </div>

              {/* Address */}
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-gray-500 uppercase">📍 Dirección</h4>
                <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border">
                  {selectedSale.address || 'No especificada'}
                </p>
              </div>

              {/* Product & Price */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">📦 Producto</h4>
                  <p className="text-sm text-gray-900">{selectedSale.product}</p>
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">💰 Total</h4>
                  <p className="text-2xl font-bold text-green-600">₡{selectedSale.total.toLocaleString()}</p>
                </div>
              </div>

              {/* Status & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">📊 Estado</h4>
                  <Badge 
                    variant={
                      selectedSale.status === 'Pendiente' ? 'warning' :
                      selectedSale.status === 'Completado' ? 'success' : 'default'
                    }
                    className="text-sm font-medium"
                  >
                    {selectedSale.status === 'Pendiente' ? '⏳' : 
                     selectedSale.status === 'Completado' ? '✅' : '📋'} {selectedSale.status}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase">🕐 Creada</h4>
                  <p className="text-sm text-gray-700">
                    {(() => {
                      const date = new Date(selectedSale.timestamp);
                      return isNaN(date.getTime())
                        ? 'Fecha inválida'
                        : formatDistanceToNow(date, { 
                            addSuffix: true,
                            locale: es 
                          });
                    })()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});