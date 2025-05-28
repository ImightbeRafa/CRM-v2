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
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';

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

export function SalesDashboard() {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [orderTypeFilter, setOrderTypeFilter] = useState<'ALL' | 'EA' | 'RA'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

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

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">₡{stats.totalAmount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Total en ventas
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.eaOrders}</div>
            <p className="text-xs text-muted-foreground">
              Envíos (EA)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.raOrders}</div>
            <p className="text-xs text-muted-foreground">
              Retiros (RA)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg font-semibold">Últimas Ventas</CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={refresh}
              disabled={isLoading}
              className="gap-2"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLoading ? 'Actualizando...' : 'Actualizar'}
            </Button>
          </div>
          <div className="flex gap-2 mt-2">
            <Select
              value={orderTypeFilter}
              onValueChange={(value: 'ALL' | 'EA' | 'RA') => setOrderTypeFilter(value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="EA">Envíos</SelectItem>
                <SelectItem value="RA">Retiros</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Buscar por nombre, orden o teléfono..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-[300px]"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Tiempo</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8">
                      <div className="flex justify-center items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Cargando ventas...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-red-500 py-8">
                      {error}
                    </TableCell>
                  </TableRow>
                ) : filteredSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      No se encontraron ventas
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSales.map((sale) => (
                    <TableRow key={sale.orderId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{sale.orderId}</span>
                          <Badge variant={sale.orderType === 'EA' ? 'default' : 'secondary'}>
                            {sale.orderType}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{sale.customerName}</div>
                          <div className="text-sm text-muted-foreground">{sale.phone}</div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">₡{sale.total.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={
                          sale.status === 'Pendiente' ? 'warning' :
                          sale.status === 'Completado' ? 'success' : 'default'
                        }>
                          {sale.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
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
                        >
                          Ver
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <span>Orden: {selectedSale?.orderId}</span>
                {selectedSale && (
                  <Badge variant={selectedSale.orderType === 'EA' ? 'default' : 'secondary'}>
                    {selectedSale.orderType}
                  </Badge>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold">Cliente</h4>
                <p>{selectedSale.customerName}</p>
              </div>
              <div>
                <h4 className="font-semibold">Teléfono</h4>
                <p>{selectedSale.phone}</p>
              </div>
              <div>
                <h4 className="font-semibold">Email</h4>
                <p>{selectedSale.email}</p>
              </div>
              <div>
                <h4 className="font-semibold">Estado</h4>
                <Badge variant={
                  selectedSale.status === 'Pendiente' ? 'warning' :
                  selectedSale.status === 'Completado' ? 'success' : 'default'
                }>
                  {selectedSale.status}
                </Badge>
              </div>
              <div className="col-span-2">
                <h4 className="font-semibold">Dirección</h4>
                <p>{selectedSale.address || 'No especificada'}</p>
              </div>
              <div>
                <h4 className="font-semibold">Producto</h4>
                <p>{selectedSale.product}</p>
              </div>
              <div>
                <h4 className="font-semibold">Total</h4>
                <p className="font-bold">₡{selectedSale.total.toLocaleString()}</p>
              </div>
              <div className="col-span-2 text-sm text-muted-foreground">
                {(() => {
                  const date = new Date(selectedSale.timestamp);
                  return isNaN(date.getTime())
                    ? 'Fecha inválida'
                    : formatDistanceToNow(date, { 
                        addSuffix: true,
                        locale: es 
                      });
                })()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}