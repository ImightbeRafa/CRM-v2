// src/app/components/RecentSales.tsx
"use client";
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { 
  Search, 
  Filter, 
  TrendingUp, 
  Clock, 
  User, 
  Phone, 
  MapPin, 
  Package,
  DollarSign,
  Calendar,
  Eye,
  RefreshCw
} from 'lucide-react';

interface Sale {
  orderId: string;
  customer: string;
  username: string;
  phone: string;
  email: string;
  address: string;
  business: string;
  product: string;
  tamano: string;
  color: string;
  empaque: string;
  comments: string;
  productCost: number;
  shippingCost: number;
  total: number;
  status: string;
  date: string;
  messenger: string;
  orderType: 'EA' | 'RA';
  province?: string;
  canton?: string;
  district?: string;
}

const RecentSales = () => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [filteredSales, setFilteredSales] = useState<Sale[]>([]);
  const [dailyTotal, setDailyTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [configFields, setConfigFields] = useState<any[]>([]);

  // Fetch configuration fields
  useEffect(() => {
    const fetchConfigFields = async () => {
      try {
        const response = await fetch('/api/config/fields');
        const data = await response.json();
        if (data.status === 'success') {
          setConfigFields(data.data);
        }
      } catch (error) {
        console.error('Error fetching config fields:', error);
      }
    };

    fetchConfigFields();
  }, []);

  // Helper function to get display value for a field
  const getFieldDisplayValue = (fieldKey: string, productValue: string) => {
    if (!productValue) {
      // Find the field configuration
      const field = configFields.find(f => f.key === fieldKey);
      if (field && field.optionSet && field.optionSet.options && field.optionSet.options.length > 0) {
        // Show available options count
        const optionsCount = field.optionSet.options.length;
        return `${optionsCount} opciones disponibles`;
      }
      return 'No especificado';
    }
    return productValue;
  };

  const fetchSales = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/orders');
      const data = await response.json();

      if (data.status === 'success') {
        // Transform database orders to match the expected format
        const transformedSales = data.data.map((order: any) => ({
          orderId: order.orderId,
          customer: order.customerName,
          username: order.username,
          phone: order.phone,
          email: order.email,
          address: order.address,
          business: order.business,
          product: order.product,
          tamano: order.size,
          color: order.color,
          empaque: order.packaging,
          comments: order.comments,
          productCost: order.productCost,
          shippingCost: order.shippingCost,
          total: order.total,
          status: order.status,
          date: order.saleDate || order.timestamp,
          messenger: order.courier,
          orderType: order.orderType
        }));
        
        setSales(transformedSales);
        setFilteredSales(transformedSales);
        
        // Calculate daily total for today's sales
        const today = new Date().toISOString().split('T')[0];
        const todaySales = transformedSales.filter((sale: any) => 
          sale.date && sale.date.startsWith(today)
        );
        const dailyTotal = todaySales.reduce((sum: number, sale: any) => sum + sale.total, 0);
        setDailyTotal(dailyTotal);
        
        setError('');
      } else {
        throw new Error(data.error || 'Error fetching data');
      }
    } catch (error) {
      console.error('Error fetching sales:', error);
      setError('Error loading data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSales();
    const interval = setInterval(fetchSales, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, []);

  // Filter sales based on search term and status
  useEffect(() => {
    let filtered = sales;

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(sale =>
        sale.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.orderId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.product.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sale.phone.includes(searchTerm)
      );
    }

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(sale => sale.status.toLowerCase() === statusFilter.toLowerCase());
    }

    setFilteredSales(filtered);
  }, [sales, searchTerm, statusFilter]);

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completado': return 'bg-green-100 text-green-800';
      case 'en proceso': return 'bg-blue-100 text-blue-800';
      case 'pendiente': return 'bg-yellow-100 text-yellow-800';
      case 'entregado': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getOrderTypeColor = (orderType: string) => {
    return orderType === 'EA' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="flex items-center justify-between">
                <div className="h-6 bg-gray-200 rounded w-1/3"></div>
                <div className="h-6 bg-gray-200 rounded w-1/4"></div>
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center space-x-4">
                    <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ zIndex: 1, position: 'relative' }}>
      {/* Daily Sales Summary */}
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-green-800">
            <TrendingUp className="h-5 w-5" />
            Resumen del Día
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">₡{dailyTotal.toLocaleString()}</div>
              <div className="text-sm text-green-700">Total del Día</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{sales.filter(s => s.date && s.date.startsWith(new Date().toISOString().split('T')[0])).length}</div>
              <div className="text-sm text-blue-700">Ventas Hoy</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{sales.length}</div>
              <div className="text-sm text-purple-700">Total Ventas</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sales List with Enhanced UI */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Ventas Recientes
              <Badge variant="outline" className="ml-2">
                {filteredSales.length}
              </Badge>
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar ventas..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-full sm:w-64"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="all">Todos los estados</option>
                <option value="pendiente">Pendiente</option>
                <option value="en proceso">En Proceso</option>
                <option value="completado">Completado</option>
                <option value="entregado">Entregado</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAll(!showAll)}
                className="whitespace-nowrap"
              >
                {showAll ? 'Ver Menos' : 'Ver Todas'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchSales}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8">
              <div className="text-red-500 mb-2">❌</div>
              <p className="text-red-500">{error}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSales.length > 0 ? (
                (showAll ? filteredSales : filteredSales.slice(0, 5)).map((sale) => (
                  <div 
                    key={sale.orderId} 
                    className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer bg-white"
                    onClick={() => setSelectedSale(sale)}
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={getOrderTypeColor(sale.orderType)}>
                            {sale.orderType}
                          </Badge>
                          <Badge className={getStatusColor(sale.status)}>
                            {sale.status}
                          </Badge>
                          <span className="text-sm font-mono text-gray-500">#{sale.orderId}</span>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-gray-400" />
                            <span className="font-medium text-gray-900">{sale.customer}</span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-600">{sale.phone}</span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-600">{sale.product}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end gap-2">
                        <div className="text-right">
                          <div className="text-lg font-bold text-green-600">
                            ₡{sale.total.toLocaleString()}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <Calendar className="h-3 w-3" />
                            {new Date(sale.date).toLocaleDateString()}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="text-xs">
                          <Eye className="h-3 w-3 mr-1" />
                          Ver Detalles
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <div className="text-gray-400 mb-2">📦</div>
                  <p className="text-gray-500">
                    {searchTerm || statusFilter !== 'all' 
                      ? 'No se encontraron ventas con los filtros aplicados' 
                      : 'No hay ventas recientes'
                    }
                  </p>
                </div>
              )}
              
              {!showAll && filteredSales.length > 5 && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowAll(true)}
                    className="text-blue-600"
                  >
                    Ver {filteredSales.length - 5} ventas más
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedSale} onOpenChange={() => setSelectedSale(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Detalles del Pedido: {selectedSale?.orderId}
            </DialogTitle>
          </DialogHeader>
          {selectedSale && (
            <div className="space-y-6">
              {/* Order Status and Type */}
              <div className="flex items-center gap-3">
                <Badge className={getOrderTypeColor(selectedSale.orderType)}>
                  {selectedSale.orderType}
                </Badge>
                <Badge className={getStatusColor(selectedSale.status)}>
                  {selectedSale.status}
                </Badge>
                <span className="text-sm text-gray-500">
                  {new Date(selectedSale.date).toLocaleDateString()}
                </span>
              </div>

              {/* Customer Information */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Información del Cliente
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Nombre</label>
                    <p className="font-medium">{selectedSale.customer}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Teléfono</label>
                    <p className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {selectedSale.phone}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Email</label>
                    <p>{selectedSale.email || 'No especificado'}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Usuario</label>
                    <p>{selectedSale.username || 'No especificado'}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-gray-600">Dirección</label>
                    <p className="flex items-start gap-1">
                      <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      {selectedSale.address || 'No especificada'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Product Information */}
              <div className="bg-green-50 p-4 rounded-lg">
                <h3 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Información del Producto
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Producto</label>
                    <p className="font-medium">{selectedSale.product}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Tamaño</label>
                    <p>{getFieldDisplayValue('tamano', selectedSale.tamano)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Color</label>
                    <p>{getFieldDisplayValue('color', selectedSale.color)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">Empaque</label>
                    <p>{selectedSale.empaque || 'No especificado'}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-gray-600">Comentarios</label>
                    <p>{selectedSale.comments || 'Sin comentarios'}</p>
                  </div>
                </div>
              </div>

              {/* Financial Information */}
              <div className="bg-purple-50 p-4 rounded-lg">
                <h3 className="font-semibold text-purple-800 mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Información Financiera
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center">
                    <label className="text-sm font-medium text-gray-600">Total</label>
                    <p className="text-2xl font-bold text-green-600">₡{selectedSale.total.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <label className="text-sm font-medium text-gray-600">Costo Producto</label>
                    <p className="text-lg font-semibold">₡{selectedSale.productCost.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <label className="text-sm font-medium text-gray-600">Envío</label>
                    <p className="text-lg font-semibold">₡{selectedSale.shippingCost.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              {/* Shipping Information */}
              {selectedSale.orderType === 'EA' && (
                <div className="bg-orange-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Información de Envío
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-600">Mensajería</label>
                      <p>{selectedSale.messenger || 'No especificada'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Provincia</label>
                      <p>{selectedSale.province || 'No especificada'}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecentSales;

