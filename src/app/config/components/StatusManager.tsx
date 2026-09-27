'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Plus, Edit, Trash2, GripVertical } from 'lucide-react';
import { ConfigPanelHeader } from '@/components/aurora/config/panels/ConfigPanelHeader';
import { AuroraEmptyState, auroraButtonPrimary } from '@/components/aurora/states/AuroraEmptyState';
import { AuroraListSkeleton } from '@/components/aurora/states/AuroraSkeleton';
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

  const openCreate = () => {
    setEditingStatus(null);
    setShowForm(true);
    setFormData({ key: '', label: '', color: '#60A5FA', order: statuses.length });
  };

  return (
    <div data-testid="config-statuses-panel">
      <ConfigPanelHeader
        title="Estados"
        subtitle="Configura el flujo de estados de tus pedidos"
        actions={
          <Button onClick={openCreate} className="bg-[#5B3FE0] text-white hover:bg-[#4A32C4]">
            <Plus className="w-4 h-4 mr-2" />
            Nuevo estado
          </Button>
        }
      />

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        {loading ? (
          <AuroraListSkeleton rows={4} label="Cargando estados" />
        ) : statuses.length === 0 ? (
          <AuroraEmptyState
            tone="neutral"
            title="Todavía no hay estados de pedido"
            description="Creá el primero para ordenar el flujo de tus pedidos."
            actions={
              <button type="button" onClick={openCreate} className={auroraButtonPrimary}>
                Nuevo estado
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {statuses.map((status) => (
              <li
                key={status.id}
                className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 px-5 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <GripVertical className="h-5 w-5 shrink-0 text-slate-300" aria-hidden />
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: status.color || '#94A3B8' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-slate-900" title={status.label}>{status.label}</p>
                    <p className="truncate text-[12px] text-slate-500" title={status.key}>{status.key}</p>
                  </div>
                  <span className="hidden shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 sm:inline-block">
                    Orden {status.order}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Editar ${status.label}`}
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
                    variant="ghost"
                    size="sm"
                    aria-label={`Eliminar ${status.label}`}
                    onClick={() => handleDelete(status.id)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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
    </div>
  );
}

