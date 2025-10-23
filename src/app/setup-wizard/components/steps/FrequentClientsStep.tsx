'use client';

import React, { useState, useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { useToast } from '@/app/hooks/use-toast';
import { Plus, Trash2, Users } from 'lucide-react';

interface Client {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export function FrequentClientsStep({ onNext, onSkip, markCompleted }: WizardStepProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadExisting();
  }, []);

  const loadExisting = async () => {
    try {
      const response = await fetch('/api/config/frequent-customers');
      if (response.ok) {
        const result = await response.json();
        if (result.data?.length > 0) {
          setClients(result.data);
          markCompleted();
        }
      }
    } catch (error) {
      console.error('Error loading clients:', error);
    }
  };

  const addClient = () => {
    setClients([...clients, { name: '', phone: '', email: '', address: '' }]);
  };

  const removeClient = (index: number) => {
    setClients(clients.filter((_, i) => i !== index));
  };

  const updateClient = (index: number, key: keyof Client, value: any) => {
    const updated = [...clients];
    updated[index] = { ...updated[index], [key]: value };
    setClients(updated);
  };

  const handleSave = async () => {
    const invalid = clients.filter(c => !c.name);
    if (invalid.length > 0) {
      toast({ title: 'Campos incompletos', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      for (const client of clients) {
        const method = client.id ? 'PUT' : 'POST';
        await fetch('/api/config/frequent-customers', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(client)
        });
      }

      markCompleted();
      toast({ title: '¡Guardado!', description: `${clients.length} clientes guardados.` });
      setTimeout(onNext, 800);
    } catch (error) {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-600" />
          Clientes Frecuentes
        </h3>
        <p className="text-gray-600">
          Guarda información de tus clientes más frecuentes para agilizar la creación de pedidos.
        </p>
      </div>

      <div className="space-y-4">
        {clients.map((client, index) => (
          <Card key={index} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nombre</Label>
                <Input
                  value={client.name}
                  onChange={(e) => updateClient(index, 'name', e.target.value)}
                  placeholder="Nombre del cliente"
                />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input
                  value={client.phone || ''}
                  onChange={(e) => updateClient(index, 'phone', e.target.value)}
                  placeholder="1234-5678"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={client.email || ''}
                  onChange={(e) => updateClient(index, 'email', e.target.value)}
                  placeholder="cliente@example.com"
                />
              </div>
              <div>
                <Label>Dirección</Label>
                <Input
                  value={client.address || ''}
                  onChange={(e) => updateClient(index, 'address', e.target.value)}
                  placeholder="Dirección completa"
                />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => removeClient(index)} className="text-red-600">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addClient} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Agregar Cliente
      </Button>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onSkip}>Omitir</Button>
        <Button onClick={handleSave} disabled={loading || clients.length === 0}>
          {loading ? 'Guardando...' : 'Guardar y Continuar'}
        </Button>
      </div>
    </div>
  );
}

