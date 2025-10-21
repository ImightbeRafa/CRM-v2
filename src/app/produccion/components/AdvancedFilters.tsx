"use client";
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Badge } from "@/app/components/ui/badge";
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Truck, 
  DollarSign,
  Filter,
  X
} from 'lucide-react';

interface AdvancedFiltersProps {
  filters: {
    dateRange: { from: string; to: string };
    priorityFilter: string;
    courierFilter: string;
  };
  onFiltersChange: {
    setDateRange: (range: { from: string; to: string }) => void;
    setPriorityFilter: (priority: string) => void;
    setCourierFilter: (courier: string) => void;
  };
  onClose: () => void;
}

export function AdvancedFilters({ 
  filters, 
  onFiltersChange, 
  onClose 
}: AdvancedFiltersProps) {
  const [localFilters, setLocalFilters] = React.useState(filters);

  const handleApply = () => {
    onFiltersChange.setDateRange(localFilters.dateRange);
    onFiltersChange.setPriorityFilter(localFilters.priorityFilter);
    onFiltersChange.setCourierFilter(localFilters.courierFilter);
    onClose();
  };

  const handleReset = () => {
    const resetFilters = {
      dateRange: { from: '', to: '' },
      priorityFilter: 'all',
      courierFilter: 'all'
    };
    setLocalFilters(resetFilters);
    onFiltersChange.setDateRange(resetFilters.dateRange);
    onFiltersChange.setPriorityFilter(resetFilters.priorityFilter);
    onFiltersChange.setCourierFilter(resetFilters.courierFilter);
  };

  const hasActiveFilters = 
    localFilters.dateRange.from || 
    localFilters.dateRange.to || 
    localFilters.priorityFilter !== 'all' || 
    localFilters.courierFilter !== 'all';

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros Avanzados
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-2">
                Filtros activos
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date Range Filter */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Rango de Fechas
            </Label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="date-from" className="text-sm text-gray-600">
                  Desde
                </Label>
                <Input
                  id="date-from"
                  type="date"
                  value={localFilters.dateRange.from}
                  onChange={(e) => setLocalFilters(prev => ({
                    ...prev,
                    dateRange: { ...prev.dateRange, from: e.target.value }
                  }))}
                />
              </div>
              <div>
                <Label htmlFor="date-to" className="text-sm text-gray-600">
                  Hasta
                </Label>
                <Input
                  id="date-to"
                  type="date"
                  value={localFilters.dateRange.to}
                  onChange={(e) => setLocalFilters(prev => ({
                    ...prev,
                    dateRange: { ...prev.dateRange, to: e.target.value }
                  }))}
                />
              </div>
            </div>
          </div>

          {/* Priority Filter */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Prioridad
            </Label>
            <Select 
              value={localFilters.priorityFilter} 
              onValueChange={(value) => setLocalFilters(prev => ({
                ...prev,
                priorityFilter: value
              }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar prioridad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las prioridades</SelectItem>
                <SelectItem value="urgent">Urgente (más de 24h pendientes)</SelectItem>
                <SelectItem value="high">Alta (más de 12h en proceso)</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Courier Filter */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Mensajería
            </Label>
            <Select 
              value={localFilters.courierFilter} 
              onValueChange={(value) => setLocalFilters(prev => ({
                ...prev,
                courierFilter: value
              }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar mensajería" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las mensajerías</SelectItem>
                <SelectItem value="correos">Correos de Costa Rica</SelectItem>
                <SelectItem value="dhl">DHL</SelectItem>
                <SelectItem value="fedex">FedEx</SelectItem>
                <SelectItem value="ups">UPS</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Additional Filters */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Filtros Adicionales
            </Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox id="high-value" />
                <Label htmlFor="high-value" className="text-sm">
                  Solo órdenes de alto valor (más de ₡50,000)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="with-comments" />
                <Label htmlFor="with-comments" className="text-sm">
                  Solo órdenes con comentarios
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox id="customization" />
                <Label htmlFor="customization" className="text-sm">
                  Solo órdenes con personalización
                </Label>
              </div>
            </div>
          </div>

          {/* Location Filter */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Ubicación
            </Label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="province" className="text-sm text-gray-600">
                  Provincia
                </Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar provincia" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las provincias</SelectItem>
                    <SelectItem value="san-jose">San José</SelectItem>
                    <SelectItem value="cartago">Cartago</SelectItem>
                    <SelectItem value="heredia">Heredia</SelectItem>
                    <SelectItem value="alajuela">Alajuela</SelectItem>
                    <SelectItem value="puntarenas">Puntarenas</SelectItem>
                    <SelectItem value="limon">Limón</SelectItem>
                    <SelectItem value="guanacaste">Guanacaste</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="canton" className="text-sm text-gray-600">
                  Cantón
                </Label>
                <Input
                  id="canton"
                  placeholder="Filtrar por cantón"
                />
              </div>
            </div>
          </div>

          {/* Active Filters Summary */}
          {hasActiveFilters && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">Filtros Activos:</h4>
              <div className="flex flex-wrap gap-2">
                {localFilters.dateRange.from && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Desde: {localFilters.dateRange.from}
                    <X className="h-3 w-3 cursor-pointer" />
                  </Badge>
                )}
                {localFilters.dateRange.to && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Hasta: {localFilters.dateRange.to}
                    <X className="h-3 w-3 cursor-pointer" />
                  </Badge>
                )}
                {localFilters.priorityFilter !== 'all' && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Prioridad: {localFilters.priorityFilter}
                    <X className="h-3 w-3 cursor-pointer" />
                  </Badge>
                )}
                {localFilters.courierFilter !== 'all' && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    Mensajería: {localFilters.courierFilter}
                    <X className="h-3 w-3 cursor-pointer" />
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleReset}>
            Limpiar Filtros
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleApply}>
            Aplicar Filtros
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
