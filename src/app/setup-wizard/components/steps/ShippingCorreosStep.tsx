'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { useToast } from '@/app/hooks/use-toast';
import {
  User,
  MapPin,
  Phone,
  Loader2,
  CheckCircle2,
  Info,
  Save,
  AlertCircle,
} from 'lucide-react';
import type { WizardStepProps } from '../SetupWizard';

interface SenderSettings {
  ws_sender_name: string;
  ws_sender_address: string;
  ws_sender_zip: string;
  ws_sender_phone: string;
}

const EMPTY_SETTINGS: SenderSettings = {
  ws_sender_name: '',
  ws_sender_address: '',
  ws_sender_zip: '',
  ws_sender_phone: '',
};

export function ShippingCorreosStep({ markCompleted, markUnsavedChanges }: WizardStepProps) {
  const [settings, setSettings] = useState<SenderSettings>(EMPTY_SETTINGS);
  const [initial, setInitial] = useState<SenderSettings>(EMPTY_SETTINGS);
  const [existingConfigId, setExistingConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [platformConfigured, setPlatformConfigured] = useState<boolean | null>(null);
  const { toast } = useToast();

  useEffect(() => { loadConfig(); checkPlatformStatus(); }, []);

  useEffect(() => {
    const changed = JSON.stringify(settings) !== JSON.stringify(initial);
    markUnsavedChanges(changed);
  }, [settings, initial, markUnsavedChanges]);

  const checkPlatformStatus = async () => {
    try {
      const res = await fetch('/api/config/correos-status', { credentials: 'include' });
      const data = await res.json();
      setPlatformConfigured(data.configured ?? false);
    } catch {
      setPlatformConfigured(false);
    }
  };

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/config/shipping-config', { credentials: 'include' });
      const data = await res.json();
      if (data.status === 'success' && data.data?.length > 0) {
        const correos = data.data.find((c: any) => c.carrier === 'correos_cr' && c.isActive);
        if (correos) {
          setExistingConfigId(correos.id);
          const s = correos.settings || {};
          const loaded: SenderSettings = {
            ws_sender_name: s.ws_sender_name || '',
            ws_sender_address: s.ws_sender_address || '',
            ws_sender_zip: s.ws_sender_zip || '',
            ws_sender_phone: s.ws_sender_phone || '',
          };
          setSettings(loaded);
          setInitial(loaded);
          if (loaded.ws_sender_name) {
            markCompleted();
          }
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const update = (key: keyof SenderSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = {
        ...(existingConfigId ? { id: existingConfigId } : {}),
        carrier: 'correos_cr',
        name: 'Correos de Costa Rica',
        isDefault: true,
        settings,
      };
      const res = await fetch('/api/config/shipping-config', {
        method: existingConfigId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        if (!existingConfigId && data.data?.id) setExistingConfigId(data.data.id);
        setInitial(settings);
        markCompleted();
        toast({ title: '¡Guardado!', description: 'Datos del remitente guardados.' });
      } else {
        throw new Error();
      }
    } catch {
      toast({ title: 'Error', description: 'No se pudo guardar la configuración.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const hasSender = !!settings.ws_sender_name;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <Card className="p-4 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Correos de Costa Rica</p>
            <p className="text-blue-700">
              Las credenciales del Web Service son administradas a nivel de plataforma.
              Aquí solo necesitás configurar los datos de tu remitente (dirección de origen).
            </p>
          </div>
        </div>
      </Card>

      {platformConfigured === false && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Las credenciales del Web Service no están configuradas a nivel de plataforma. Contacte al administrador.
        </div>
      )}

      {platformConfigured && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Servicio de Correos CR Activo
          </Badge>
        </div>
      )}

      {/* Sender Info */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <User className="h-4 w-4 text-gray-500" />
          Datos del Remitente
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <User className="h-3.5 w-3.5 text-gray-400" /> Nombre / Empresa
            </Label>
            <Input
              value={settings.ws_sender_name}
              onChange={e => update('ws_sender_name', e.target.value)}
              placeholder="Mi Empresa S.A."
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <Phone className="h-3.5 w-3.5 text-gray-400" /> Teléfono Remitente
            </Label>
            <Input
              value={settings.ws_sender_phone}
              onChange={e => update('ws_sender_phone', e.target.value)}
              placeholder="22345678"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="flex items-center gap-1.5 mb-1">
              <MapPin className="h-3.5 w-3.5 text-gray-400" /> Dirección del Remitente
            </Label>
            <Input
              value={settings.ws_sender_address}
              onChange={e => update('ws_sender_address', e.target.value)}
              placeholder="Barrio Los Yoses, San Pedro, San José"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <MapPin className="h-3.5 w-3.5 text-gray-400" /> Código Postal
            </Label>
            <Input
              value={settings.ws_sender_zip}
              onChange={e => update('ws_sender_zip', e.target.value)}
              placeholder="10107"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={!hasSender || saving}
          className="flex-1"
        >
          {saving ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>
          ) : (
            <><Save className="h-4 w-4 mr-2" />Guardar Datos del Remitente</>
          )}
        </Button>
      </div>
    </div>
  );
}
