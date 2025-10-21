'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Plus, Edit, Trash2, Settings, Calendar, List, Type } from 'lucide-react';

interface BusinessInfo {
  id: string;
  name: string;
  type: 'dropdown' | 'date' | 'text' | 'textarea';
  label: string;
  placeholder?: string;
  options?: string;
  required: boolean;
  order: number;
  isActive: boolean;
}

export function BusinessInfoManagement() {
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<BusinessInfo | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'text' as 'dropdown' | 'date' | 'text' | 'textarea',
    label: '',
    placeholder: '',
    options: '',
    required: false,
    order: 0
  });

  useEffect(() => {
    fetchBusinessInfo();
  }, []);

  const fetchBusinessInfo = async () => {
    try {
      const response = await fetch('/api/config/business-info');
      const data = await response.json();
      if (data.status === 'success') {
        setBusinessInfo(data.data);
      }
    } catch (error) {
      console.error('Error fetching business info:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const url = editingItem ? '/api/config/business-info' : '/api/config/business-info';
      const method = editingItem ? 'PUT' : 'POST';
      
      const payload = {
        ...formData,
        ...(editingItem && { id: editingItem.id })
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        await fetchBusinessInfo();
        setShowForm(false);
        setEditingItem(null);
        setFormData({
          name: '',
          type: 'text',
          label: '',
          placeholder: '',
          options: '',
          required: false,
          order: 0
        });
      }
    } catch (error) {
      console.error('Error saving business info:', error);
    }
  };

  const handleEdit = (item: BusinessInfo) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      type: item.type,
      label: item.label,
      placeholder: item.placeholder || '',
      options: item.options || '',
      required: item.required,
      order: item.order
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de que quieres eliminar este campo?')) {
      try {
        const response = await fetch(`/api/config/business-info?id=${id}`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          await fetchBusinessInfo();
        }
      } catch (error) {
        console.error('Error deleting business info:', error);
      }
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'dropdown': return <List className="h-4 w-4" />;
      case 'date': return <Calendar className="h-4 w-4" />;
      case 'textarea': return <Type className="h-4 w-4" />;
      default: return <Settings className="h-4 w-4" />;
    }
  };

  if (loading) {
    return <div className="p-4">Cargando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Campos de Información de Negocio</h2>
        <Button onClick={() => setShowForm(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Agregar Campo
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingItem ? 'Editar Campo' : 'Nuevo Campo'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Nombre del Campo</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="ej: negocio, canal_ventas"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="type">Tipo de Campo</Label>
                  <select
                    id="type"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full p-2 border rounded-md"
                  >
                    <option value="text">Texto</option>
                    <option value="textarea">Área de Texto</option>
                    <option value="dropdown">Lista Desplegable</option>
                    <option value="date">Fecha</option>
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="label">Etiqueta</Label>
                <Input
                  id="label"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="ej: Negocio, Canal de Ventas"
                  required
                />
              </div>

              <div>
                <Label htmlFor="placeholder">Texto de Ayuda</Label>
                <Input
                  id="placeholder"
                  value={formData.placeholder}
                  onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                  placeholder="ej: Selecciona tu negocio"
                />
              </div>

              {formData.type === 'dropdown' && (
                <div>
                  <Label htmlFor="options">Opciones (una por línea)</Label>
                  <textarea
                    id="options"
                    value={formData.options}
                    onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                    placeholder="Opción 1&#10;Opción 2&#10;Opción 3"
                    className="w-full p-2 border rounded-md h-20"
                  />
                </div>
              )}

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.required}
                    onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                  />
                  Campo obligatorio
                </label>
                <div>
                  <Label htmlFor="order">Orden</Label>
                  <Input
                    id="order"
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                    className="w-20"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  {editingItem ? 'Actualizar' : 'Crear'}
                </Button>
                <Button type="button" variant="outline" onClick={() => {
                  setShowForm(false);
                  setEditingItem(null);
                  setFormData({
                    name: '',
                    type: 'text',
                    label: '',
                    placeholder: '',
                    options: '',
                    required: false,
                    order: 0
                  });
                }}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {businessInfo.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getTypeIcon(item.type)}
                  <div>
                    <h3 className="font-medium">{item.label}</h3>
                    <p className="text-sm text-gray-500">{item.name}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant={item.type === 'dropdown' ? 'default' : 'secondary'}>
                        {item.type}
                      </Badge>
                      {item.required && <Badge variant="destructive">Obligatorio</Badge>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(item)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {businessInfo.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <Settings className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No hay campos configurados</h3>
            <p className="text-gray-500 mb-4">
              Agrega campos personalizados para tu formulario de ventas
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar Primer Campo
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
