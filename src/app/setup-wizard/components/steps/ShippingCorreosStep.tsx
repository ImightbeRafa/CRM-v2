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
  /** Origin place for Correos v3 quotes and pickups. */
  ws_sender_province: string;
  ws_sender_canton: string;
  ws_sender_district: string;
  /** Default package weight in grams for guías (v3). */
  ws_default_weight_g: string;
  /** 'v3' = this store uses the new Correos REST API (when the platform has it on). */
  correos_api: 'soap' | 'v3';
  /** Requester for Correos pickups (Correos asks for cédula + email). */
  correos_pickup_cedula: string;
  correos_pickup_email: string;
}

const EMPTY_SETTINGS: SenderSettings = {
  ws_sender_name: '',
  ws_sender_address: '',
  ws_sender_zip: '',
  ws_sender_phone: '',
  ws_sender_province: '',
  ws_sender_canton: '',
  ws_sender_district: '',
  ws_default_weight_g: '',
  correos_api: 'soap',
  correos_pickup_cedula: '',
  correos_pickup_email: '',
};

export function ShippingCorreosStep({ markCompleted, markUnsavedChanges }: WizardStepProps) {
  const [settings, setSettings] = useState<SenderSettings>(EMPTY_SETTINGS);
  const [initial, setInitial] = useState<SenderSettings>(EMPTY_SETTINGS);
  const [existingConfigId, setExistingConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [platformConfigured, setPlatformConfigured] = useState<boolean | null>(null);
  const [v3Available, setV3Available] = useState(false);
  // Keys of ShippingConfig.settings this form does not edit; kept on save.
  const [otherSettings, setOtherSettings] = useState<Record<string, unknown>>({});
  const { toast } = useToast();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
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
      setV3Available(!!data.v3?.enabled);
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
            ws_sender_province: s.ws_sender_province || '',
            ws_sender_canton: s.ws_sender_canton || '',
            ws_sender_district: s.ws_sender_district || '',
            ws_default_weight_g: s.ws_default_weight_g ? String(s.ws_default_weight_g) : '',
            correos_api: s.correos_api === 'v3' ? 'v3' : 'soap',
            correos_pickup_cedula: s.correos_pickup_cedula || '',
            correos_pickup_email: s.correos_pickup_email || '',
          };
          const rest: Record<string, unknown> = { ...s };
          for (const k of Object.keys(EMPTY_SETTINGS)) delete rest[k];
          setOtherSettings(rest);
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
        settings: { ...otherSettings, ...settings },
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
  const phoneOk = /^[2-9]\d{7}$/.test(settings.ws_sender_phone.replace(/\D/g, '').replace(/^506(?=\d{8}$)/, ''));
  const zipOk = /^\d{5}$/.test(settings.ws_sender_zip.trim());

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-au-ink-5b6cff" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <Card className="p-4 bg-au-tint-f1eeff border-au-line-d9d2ff">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-au-ink-5b6cff flex-shrink-0 mt-0.5" />
          <div className="text-sm text-au-ink-4b36b8">
            <p className="font-medium mb-1">Correos de Costa Rica</p>
            <p className="text-au-ink-4b36b8">
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

      {/* Origin + Correos v3 */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-gray-500" />
          Lugar de origen
        </h3>
        <p className="text-xs text-gray-500 mb-3">Se usa para cotizar el envío real y para pedir recolecciones a Correos.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label className="mb-1 block">Provincia</Label>
            <Input value={settings.ws_sender_province} onChange={e => update('ws_sender_province', e.target.value)} placeholder="San José" />
          </div>
          <div>
            <Label className="mb-1 block">Cantón</Label>
            <Input value={settings.ws_sender_canton} onChange={e => update('ws_sender_canton', e.target.value)} placeholder="Montes de Oca" />
          </div>
          <div>
            <Label className="mb-1 block">Distrito</Label>
            <Input value={settings.ws_sender_district} onChange={e => update('ws_sender_district', e.target.value)} placeholder="San Pedro" />
          </div>
          <div>
            <Label className="mb-1 block">Peso por paquete (g)</Label>
            <Input value={settings.ws_default_weight_g} onChange={e => update('ws_default_weight_g', e.target.value.replace(/\D/g, ''))} placeholder="500" inputMode="numeric" />
          </div>
        </div>
        {hasSender && (!phoneOk || !zipOk) && (
          <p className="text-xs text-amber-700 mt-2">
            {!phoneOk && 'El teléfono del remitente debe tener 8 dígitos. '}
            {!zipOk && 'El código postal debe tener 5 dígitos.'}
          </p>
        )}
      </div>

      {v3Available && (
        <Card className="p-4 border-au-line-d9d2ff">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-au-ink-5b6cff"
              checked={settings.correos_api === 'v3'}
              onChange={e => setSettings(prev => ({ ...prev, correos_api: e.target.checked ? 'v3' : 'soap' }))}
            />
            <span className="text-sm">
              <span className="font-medium text-gray-900">Usar la nueva API de Correos (v3)</span>
              <span className="block text-gray-500 text-xs mt-0.5">
                Entrega en sucursal, etiqueta térmica, cotización real con medidas, aviso de zonas restringidas y recolecciones.
              </span>
            </span>
          </label>
          {settings.correos_api === 'v3' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pl-7">
              <div>
                <Label className="mb-1 block text-xs">Cédula para recolecciones</Label>
                <Input value={settings.correos_pickup_cedula} onChange={e => update('correos_pickup_cedula', e.target.value)} placeholder="1-1111-1111" />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Correo para recolecciones</Label>
                <Input type="email" value={settings.correos_pickup_email} onChange={e => update('correos_pickup_email', e.target.value)} placeholder="envios@mitienda.com" />
              </div>
            </div>
          )}
        </Card>
      )}

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
