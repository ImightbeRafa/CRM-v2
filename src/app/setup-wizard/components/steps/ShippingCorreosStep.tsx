'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { useToast } from '@/app/hooks/use-toast';
import {
  Truck,
  Mail,
  Lock,
  Key,
  User,
  MapPin,
  Phone,
  Hash,
  Loader2,
  CheckCircle2,
  XCircle,
  TestTube,
  ExternalLink,
  Info,
  Save,
} from 'lucide-react';
import type { WizardStepProps } from '../SetupWizard';

interface CorreosSettings {
  ws_username: string;
  ws_password: string;
  ws_sistema: string;
  ws_usuario_id: string;
  ws_servicio_id: string;
  ws_cod_cliente: string;
  ws_sender_name: string;
  ws_sender_address: string;
  ws_sender_zip: string;
  ws_sender_phone: string;
}

const EMPTY_SETTINGS: CorreosSettings = {
  ws_username: '',
  ws_password: '',
  ws_sistema: '',
  ws_usuario_id: '',
  ws_servicio_id: '',
  ws_cod_cliente: '',
  ws_sender_name: '',
  ws_sender_address: '',
  ws_sender_zip: '',
  ws_sender_phone: '',
};

export function ShippingCorreosStep({ markCompleted, markUnsavedChanges }: WizardStepProps) {
  const [settings, setSettings] = useState<CorreosSettings>(EMPTY_SETTINGS);
  const [initial, setInitial] = useState<CorreosSettings>(EMPTY_SETTINGS);
  const [existingConfigId, setExistingConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const { toast } = useToast();

  useEffect(() => { loadConfig(); }, []);

  useEffect(() => {
    const changed = JSON.stringify(settings) !== JSON.stringify(initial);
    markUnsavedChanges(changed);
  }, [settings, initial, markUnsavedChanges]);

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/config/shipping-config', { credentials: 'include' });
      const data = await res.json();
      if (data.status === 'success' && data.data?.length > 0) {
        const correos = data.data.find((c: any) => c.carrier === 'correos_cr' && c.isActive);
        if (correos) {
          setExistingConfigId(correos.id);
          const s = correos.settings || {};
          const loaded: CorreosSettings = {
            ws_username: s.ws_username || '',
            ws_password: s.ws_password || '',
            ws_sistema: s.ws_sistema || '',
            ws_usuario_id: s.ws_usuario_id || '',
            ws_servicio_id: s.ws_servicio_id || '',
            ws_cod_cliente: s.ws_cod_cliente || '',
            ws_sender_name: s.ws_sender_name || '',
            ws_sender_address: s.ws_sender_address || '',
            ws_sender_zip: s.ws_sender_zip || '',
            ws_sender_phone: s.ws_sender_phone || '',
          };
          setSettings(loaded);
          setInitial(loaded);
          if (loaded.ws_username && loaded.ws_password) {
            markCompleted();
          }
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const update = (key: keyof CorreosSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/config/correos-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult('success');
        toast({ title: 'Conexión exitosa', description: 'Las credenciales de Correos CR son válidas.' });
      } else {
        setTestResult('error');
        toast({ title: 'Error de conexión', description: data.error || 'No se pudo conectar con Correos CR.', variant: 'destructive' });
      }
    } catch {
      setTestResult('error');
      toast({ title: 'Error', description: 'No se pudo verificar la conexión.', variant: 'destructive' });
    } finally { setTesting(false); }
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
        toast({ title: '¡Guardado!', description: 'Configuración de Correos CR guardada.' });
      } else {
        throw new Error();
      }
    } catch {
      toast({ title: 'Error', description: 'No se pudo guardar la configuración.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const hasCredentials = settings.ws_username && settings.ws_password;

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
            <p className="font-medium mb-1">¿No tenés credenciales de Correos de Costa Rica?</p>
            <p className="text-blue-700">
              Podés obtenerlas contactando a Correos de Costa Rica o visitando su portal de servicios.
              Este paso es opcional &mdash; podés configurarlo después en Configuración &gt; Envíos.
            </p>
            <a
              href="/docs/correos-cr-setup"
              target="_blank"
              className="inline-flex items-center gap-1 mt-2 text-blue-600 hover:text-blue-800 font-medium"
            >
              Ver guía completa <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </Card>

      {/* Web Service Credentials */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Key className="h-4 w-4 text-gray-500" />
          Credenciales del Web Service
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <Mail className="h-3.5 w-3.5 text-gray-400" /> Usuario WS
            </Label>
            <Input
              value={settings.ws_username}
              onChange={e => update('ws_username', e.target.value)}
              placeholder="ccrWS..."
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <Lock className="h-3.5 w-3.5 text-gray-400" /> Contraseña WS
            </Label>
            <Input
              type="password"
              value={settings.ws_password}
              onChange={e => update('ws_password', e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <Hash className="h-3.5 w-3.5 text-gray-400" /> Sistema
            </Label>
            <Input
              value={settings.ws_sistema}
              onChange={e => update('ws_sistema', e.target.value)}
              placeholder="PYMEXPRESS"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <Hash className="h-3.5 w-3.5 text-gray-400" /> Usuario ID
            </Label>
            <Input
              value={settings.ws_usuario_id}
              onChange={e => update('ws_usuario_id', e.target.value)}
              placeholder="117960921"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <Hash className="h-3.5 w-3.5 text-gray-400" /> Servicio ID
            </Label>
            <Input
              value={settings.ws_servicio_id}
              onChange={e => update('ws_servicio_id', e.target.value)}
              placeholder="1564"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 mb-1">
              <Hash className="h-3.5 w-3.5 text-gray-400" /> Código Cliente
            </Label>
            <Input
              value={settings.ws_cod_cliente}
              onChange={e => update('ws_cod_cliente', e.target.value)}
              placeholder="7362097"
            />
          </div>
        </div>
      </div>

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
          variant="outline"
          onClick={handleTest}
          disabled={!hasCredentials || testing}
          className="flex-1"
        >
          {testing ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Probando...</>
          ) : testResult === 'success' ? (
            <><CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />Conexión Exitosa</>
          ) : testResult === 'error' ? (
            <><XCircle className="h-4 w-4 mr-2 text-red-600" />Falló - Reintentar</>
          ) : (
            <><TestTube className="h-4 w-4 mr-2" />Probar Conexión</>
          )}
        </Button>

        <Button
          onClick={handleSave}
          disabled={!hasCredentials || saving}
          className="flex-1"
        >
          {saving ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>
          ) : (
            <><Save className="h-4 w-4 mr-2" />Guardar Configuración</>
          )}
        </Button>
      </div>
    </div>
  );
}
