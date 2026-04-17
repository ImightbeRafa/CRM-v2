'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Badge } from '@/app/components/ui/badge';
import { Plus, Edit, Trash2, CheckCircle, GripVertical } from 'lucide-react';
import { useToast } from '@/app/hooks/use-toast';

export interface OrderStatus {
  id: string;
  key: string;
  label: string;
  color: string | null;
  order: number;
  isActive: boolean;
}

interface StatusManagerProps {
  statuses: OrderStatus[];
  loading?: boolean;
  onRefresh?: () => Promise<void> | void;
}

export function StatusManager({ statuses, loading = false, onRefresh }: StatusManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingStatus, setEditingStatus] = useState<OrderStatus | null>(null);
  const [formData, setFormData] = useState({ key: '', label: '', color: '#60A5FA', order: 0 });
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingStatus ? '/api/config/status' : '/api/config/status';
      const method = editingStatus ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingStatus ? { ...formData, id: editingStatus.id } : formData)
      });

      const json = await res.json();
      
      if (json.status === 'success') {
        toast({
          title: "✅ Estado guardado",
          description: editingStatus ? "Estado actualizado correctamente" : "Estado creado correctamente"
        });
        await onRefresh?.();
        setShowForm(false);
        setEditingStatus(null);
        setFormData({ key: '', label: '', color: '#60A5FA', order: statuses.length });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo guardar el estado"
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este estado?')) return;
    
    try {
      const res = await fetch(`/api/config/status?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      
      if (json.status === 'success') {
        toast({
          title: "✅ Estado eliminado",
          description: "El estado ha sido desactivado"
        });
        await onRefresh?.();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar el estado"
      });
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-card/20 rounded-xl">
              <CheckCircle className="w-8 h-8" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold">Estados de Órdenes</CardTitle>
              <p className="text-gray-100 mt-1">Configura el flujo de estados de producción</p>
            </div>
          </div>
          <Button
            onClick={() => {
              setEditingStatus(null);
              setShowForm(true);
              setFormData({ key: '', label: '', color: '#60A5FA', order: statuses.length });
            }}
            className="bg-card/20 hover:bg-card/30 text-white border-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Estado
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando...</div>
        ) : statuses.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No hay estados configurados. Haz click en &quot;Nuevo Estado&quot; para agregar uno.
          </div>
        ) : (
          <div className="grid gap-3">
            {statuses.map((status) => (
              <div
                key={status.id}
                className="flex items-center justify-between p-4 border border-border rounded-lg hover:shadow-md transition-shadow bg-card"
              >
                <div className="flex items-center gap-4">
                  <GripVertical className="h-5 w-5 text-muted-foreground cursor-move" />
                  <div
                    className="w-4 h-4 rounded-full border-2 border-border"
                    style={{ backgroundColor: status.color || '#gray' }}
                  />
                  <div>
                    <p className="font-semibold text-foreground">{status.label}</p>
                    <p className="text-sm text-muted-foreground">{status.key}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Orden: {status.order}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingStatus(status);
                      setFormData({
                        key: status.key,
                        label: status.label,
                        color: status.color || '#60A5FA',
                        order: status.order
                      });
                      setShowForm(true);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(status.id)}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>{editingStatus ? 'Editar Estado' : 'Nuevo Estado'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Clave</label>
                    <Input
                      value={formData.key}
                      onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                      placeholder="Ej: Pendiente"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Etiqueta</label>
                    <Input
                      value={formData.label}
                      onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                      placeholder="Ej: Pendiente"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Color</label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                        className="w-20 h-10"
                      />
                      <Input
                        value={formData.color}
                        onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                        placeholder="#60A5FA"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Orden</label>
                    <Input
                      type="number"
                      value={formData.order}
                      onChange={(e) => setFormData({ ...formData, order: Number(e.target.value) })}
                      required
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowForm(false);
                        setEditingStatus(null);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit">
                      {editingStatus ? 'Actualizar' : 'Crear'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

