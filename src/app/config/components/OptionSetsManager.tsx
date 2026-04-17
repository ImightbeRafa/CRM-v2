'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import { useToast } from '@/app/hooks/use-toast';
import { 
  Database,
  Plus,
  Edit,
  Trash2,
  List,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Save,
  X
} from 'lucide-react';

interface Option {
  id: string;
  label: string;
  value: string;
  priceDelta: number;
  active: boolean;
}

interface OptionSet {
  id: string;
  key: string;
  name: string;
  active: boolean;
  options: Option[];
}

export function OptionSetsManager() {
  const [optionSets, setOptionSets] = useState<OptionSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSet, setExpandedSet] = useState<string | null>(null);
  const [editingOption, setEditingOption] = useState<Option | null>(null);
  const [newOption, setNewOption] = useState<{ setId: string } | null>(null);
  const { toast } = useToast();

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config/option-sets');
      const json = await res.json();
      
      if (json.status === 'success') {
        setOptionSets(json.data);
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: json.error || "Failed to load option sets"
        });
      }
    } catch (error) {
      console.error('Error loading option sets:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load option sets"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddOption = async (setId: string, formData: FormData) => {
    try {
      const payload = {
        setId,
        label: formData.get('label'),
        value: formData.get('value'),
        priceDelta: Number(formData.get('priceDelta')) || 0,
        metadata: null
      };

      const res = await fetch('/api/config/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      
      if (json.status === 'success') {
        toast({
          title: "✅ Opción agregada",
          description: "La opción se agregó correctamente"
        });
        setNewOption(null);
        await loadData();
      } else {
        throw new Error(json.error || 'Error al agregar opción');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo agregar la opción"
      });
    }
  };

  const handleUpdateOption = async (option: Option, formData: FormData) => {
    try {
      const payload = {
        id: option.id,
        label: formData.get('label'),
        value: formData.get('value'),
        priceDelta: Number(formData.get('priceDelta')) || 0,
        active: true
      };

      const res = await fetch('/api/config/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      
      if (json.status === 'success') {
        toast({
          title: "✅ Opción actualizada",
          description: "Los cambios se guardaron correctamente"
        });
        setEditingOption(null);
        await loadData();
      } else {
        throw new Error(json.error || 'Error al actualizar opción');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo actualizar la opción"
      });
    }
  };

  const handleDeleteOption = async (optionId: string) => {
    if (!confirm('¿Eliminar esta opción?')) return;
    
    try {
      const res = await fetch(`/api/config/options?id=${optionId}`, { method: 'DELETE' });
      const json = await res.json();
      
      if (json.status === 'success') {
        toast({
          title: "✅ Opción eliminada",
          description: "La opción se eliminó correctamente"
        });
        await loadData();
      } else {
        throw new Error(json.error || 'Error al eliminar opción');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar la opción"
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-600 rounded-lg">
                <List className="w-6 h-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl text-foreground">
                  Conjuntos de Opciones
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Gestiona las opciones disponibles para campos de selección
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-lg px-4 py-2">
              {optionSets.length} conjuntos
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Option Sets List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-muted-foreground" />
            Campos con Opciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          {optionSets.length === 0 ? (
            <div className="text-center py-12">
              <Database className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground text-lg font-medium">No hay conjuntos de opciones</p>
              <p className="text-muted-foreground text-sm mt-2">
                Crea campos de tipo &quot;Selección&quot; para empezar
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {optionSets.map((set) => (
                <div key={set.id} className="border border-border rounded-lg overflow-hidden">
                  {/* Option Set Header */}
                  <div
                    className="flex items-center justify-between p-4 bg-muted hover:bg-accent transition-colors cursor-pointer"
                    onClick={() => setExpandedSet(expandedSet === set.id ? null : set.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-card rounded-lg shadow-sm">
                        <List className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{set.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {set.options.length} {set.options.length === 1 ? 'opción' : 'opciones'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{set.key}</Badge>
                      {expandedSet === set.id ? (
                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Options List */}
                  {expandedSet === set.id && (
                    <div className="p-4 bg-card border-t border-border">
                      <div className="space-y-2 mb-4">
                        {set.options.map((option) => (
                          <div
                            key={option.id}
                            className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-accent transition-colors"
                          >
                            {editingOption?.id === option.id ? (
                              // Edit Form
                              <form
                                className="flex-1 flex items-center gap-2"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  handleUpdateOption(option, new FormData(e.currentTarget));
                                }}
                              >
                                <Input
                                  name="label"
                                  defaultValue={option.label}
                                  placeholder="Etiqueta"
                                  className="flex-1"
                                  required
                                />
                                <Input
                                  name="value"
                                  defaultValue={option.value}
                                  placeholder="Valor"
                                  className="flex-1"
                                  required
                                />
                                <Input
                                  name="priceDelta"
                                  type="number"
                                  defaultValue={option.priceDelta}
                                  placeholder="₡ Delta"
                                  className="w-28"
                                />
                                <Button type="submit" size="sm" className="bg-green-600 hover:bg-green-700">
                                  <Save className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingOption(null)}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </form>
                            ) : (
                              // Display Mode
                              <>
                                <div className="flex items-center gap-3 flex-1">
                                  <span className="font-medium text-foreground">{option.label}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {option.value}
                                  </Badge>
                                  {option.priceDelta !== 0 && (
                                    <Badge className="text-xs bg-green-100 text-green-700">
                                      <DollarSign className="w-3 h-3 mr-1" />
                                      {option.priceDelta > 0 ? '+' : ''}₡{option.priceDelta}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingOption(option)}
                                    className="text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteOption(option.id)}
                                    className="text-red-600 hover:text-red-800 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Add New Option Form */}
                      {newOption?.setId === set.id ? (
                        <form
                          className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border-2 border-blue-200"
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleAddOption(set.id, new FormData(e.currentTarget));
                          }}
                        >
                          <Input
                            name="label"
                            placeholder="Etiqueta (ej: Rojo)"
                            className="flex-1"
                            required
                          />
                          <Input
                            name="value"
                            placeholder="Valor (ej: rojo)"
                            className="flex-1"
                            required
                          />
                          <Input
                            name="priceDelta"
                            type="number"
                            placeholder="₡ Delta"
                            defaultValue="0"
                            className="w-28"
                          />
                          <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700">
                            <Save className="w-4 h-4 mr-1" />
                            Guardar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setNewOption(null)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </form>
                      ) : (
                        <Button
                          onClick={() => setNewOption({ setId: set.id })}
                          variant="outline"
                          size="sm"
                          className="w-full border-dashed border-2 border-blue-300 text-blue-600 hover:bg-blue-50"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Agregar Nueva Opción
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default OptionSetsManager;

