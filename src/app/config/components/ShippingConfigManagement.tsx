'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import {
  Save,
  Eye,
  EyeOff,
  CheckCircle,
  Loader2,
  Wifi,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';

interface ShippingConfig {
  id: string;
  carrier: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  settings?: Record<string, any>;
}

export function ShippingConfigManagement() {
  const { user, loading: userLoading } = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);

  const [wsUsername, setWsUsername] = useState('');
  const [wsPassword, setWsPassword] = useState('');
  const [wsSistema, setWsSistema] = useState('');
  const [wsUsuarioId, setWsUsuarioId] = useState('');
  const [wsServicioId, setWsServicioId] = useState('');
  const [wsCodCliente, setWsCodCliente] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);

  const [senderName, setSenderName] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [senderZip, setSenderZip] = useState('');
  const [senderPhone, setSenderPhone] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const buildSettings = useCallback(() => {
    const settings: Record<string, string> = {
      ws_username: wsUsername.trim(),
      ws_sistema: wsSistema.trim(),
      ws_usuario_id: wsUsuarioId.trim(),
      ws_servicio_id: wsServicioId.trim(),
      ws_cod_cliente: wsCodCliente.trim(),
      ws_sender_name: senderName.trim(),
      ws_sender_address: senderAddress.trim(),
      ws_sender_zip: senderZip.trim(),
      ws_sender_phone: senderPhone.trim(),
    };
    if (wsPassword) {
      settings.ws_password = wsPassword;
    }
    return settings;
  }, [wsUsername, wsPassword, wsSistema, wsUsuarioId, wsServicioId, wsCodCliente, senderName, senderAddress, senderZip, senderPhone]);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config/shipping-config', { credentials: 'include' });
      const result = await res.json();
      if (result.status === 'success' && Array.isArray(result.data)) {
        const correosConfig = result.data.find(
          (c: ShippingConfig) => c.carrier.toLowerCase() === 'correos_cr' && c.isActive
        );
        if (correosConfig) {
          setExistingId(correosConfig.id);
          const s = correosConfig.settings || {};
          setWsUsername(s.ws_username || '');
          setWsSistema(s.ws_sistema || '');
          setWsUsuarioId(s.ws_usuario_id || '');
          setWsServicioId(s.ws_servicio_id || '');
          setWsCodCliente(s.ws_cod_cliente || '');
          setSenderName(s.ws_sender_name || '');
          setSenderAddress(s.ws_sender_address || '');
          setSenderZip(s.ws_sender_zip || '');
          setSenderPhone(s.ws_sender_phone || '');
          setHasCredentials(!!s.ws_password && s.ws_password !== '');
        }
      }
    } catch (err) {
      console.error('Error loading Correos CR config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!wsUsername.trim()) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);

    try {
      const method = existingId ? 'PUT' : 'POST';
      const payload: Record<string, any> = {
        carrier: 'correos_cr',
        name: 'Correos de Costa Rica',
        isDefault: true,
        settings: buildSettings(),
      };
      if (existingId) {
        payload.id = existingId;
      }

      const res = await fetch('/api/config/shipping-config', {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        if (!existingId && result.data?.id) {
          setExistingId(result.data.id);
        }
        setHasCredentials(true);
        setWsPassword('');
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const errData = await res.json().catch(() => null);
        setSaveError(errData?.error || 'Error al guardar la configuración');
      }
    } catch (err) {
      console.error('Error saving Correos CR config:', err);
      setSaveError('Error de conexión al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!wsUsername.trim()) return;
    setTesting(true);
    setTestResult(null);

    const settings = buildSettings();
    if (!settings.ws_password && !hasCredentials) {
      setTestResult({ success: false, message: 'Se requiere contraseña para probar la conexión.' });
      setTesting(false);
      return;
    }

    try {
      const res = await fetch('/api/config/correos-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings }),
      });
      const data = await res.json();
      setTestResult({
        success: data.success,
        message: data.success ? data.message : (data.error || 'Error desconocido'),
      });
    } catch (err) {
      setTestResult({ success: false, message: 'No se pudo conectar al servidor de pruebas.' });
    } finally {
      setTesting(false);
    }
  };

  if (userLoading || loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando configuración de Correos CR...
      </div>
    );
  }

  if (!user || user.role !== 'MASTER') {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground">
              Solo los usuarios MASTER pueden acceder a la configuración de envíos.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-bold">Correos de Costa Rica</h2>
          {hasCredentials && (
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
              <CheckCircle className="h-3 w-3 mr-1" />
              Configurado
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Configuración del Web Service SOAP para la generación automática de guías
        </p>
      </div>

      {/* Web Service (SOAP API) */}
      <Card className="border-emerald-200 dark:border-emerald-800/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Wifi className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">Web Service (SOAP API)</h3>
            <span className="text-xs text-muted-foreground">Credenciales proporcionadas por Correos CR</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ws_username">Username</Label>
              <Input
                id="ws_username"
                value={wsUsername}
                onChange={(e) => setWsUsername(e.target.value)}
                placeholder="ccrWS0000000"
              />
            </div>
            <div>
              <Label htmlFor="ws_password">
                Password
                {hasCredentials && (
                  <span className="text-xs text-muted-foreground font-normal ml-1">(vacío = mantener)</span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="ws_password"
                  type={showPassword ? 'text' : 'password'}
                  value={wsPassword}
                  onChange={(e) => setWsPassword(e.target.value)}
                  placeholder={hasCredentials ? '••••••••' : 'Contraseña WS'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="ws_sistema">Sistema</Label>
            <Input
              id="ws_sistema"
              value={wsSistema}
              onChange={(e) => setWsSistema(e.target.value)}
              placeholder="PYMEXPRESS"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="ws_usuario_id">Usuario ID</Label>
              <Input
                id="ws_usuario_id"
                value={wsUsuarioId}
                onChange={(e) => setWsUsuarioId(e.target.value)}
                placeholder="100000000"
              />
            </div>
            <div>
              <Label htmlFor="ws_servicio_id">Servicio ID</Label>
              <Input
                id="ws_servicio_id"
                value={wsServicioId}
                onChange={(e) => setWsServicioId(e.target.value)}
                placeholder="1000"
              />
            </div>
            <div>
              <Label htmlFor="ws_cod_cliente">Código Cliente</Label>
              <Input
                id="ws_cod_cliente"
                value={wsCodCliente}
                onChange={(e) => setWsCodCliente(e.target.value)}
                placeholder="0000000"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Datos del Remitente */}
      <Card className="border-amber-200 dark:border-amber-800/60">
        <CardContent className="p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-base">📦</span>
              <h3 className="font-semibold text-sm text-amber-800 dark:text-amber-300">Datos del Remitente</h3>
            </div>
            <p className="text-xs text-muted-foreground ml-7">
              Información que aparece como remitente en cada guía generada
            </p>
          </div>

          <div>
            <Label htmlFor="ws_sender_name">Nombre del Remitente</Label>
            <Input
              id="ws_sender_name"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Mi Empresa S.A."
            />
          </div>

          <div>
            <Label htmlFor="ws_sender_address">Dirección del Remitente</Label>
            <Input
              id="ws_sender_address"
              value={senderAddress}
              onChange={(e) => setSenderAddress(e.target.value)}
              placeholder="Barrio Los Yoses, San Pedro, San José"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ws_sender_zip">Código Postal</Label>
              <Input
                id="ws_sender_zip"
                value={senderZip}
                onChange={(e) => setSenderZip(e.target.value)}
                placeholder="10107"
              />
            </div>
            <div>
              <Label htmlFor="ws_sender_phone">Teléfono</Label>
              <Input
                id="ws_sender_phone"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                placeholder="22345678"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Test result feedback */}
      {testResult && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            testResult.success
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300'
          }`}
        >
          {testResult.success ? (
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {testResult.message}
        </div>
      )}

      {/* Save error feedback */}
      {saveError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {saveError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handleTest}
          disabled={testing || !wsUsername.trim()}
          variant="outline"
          className="flex items-center gap-2"
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : testResult?.success ? (
            <Wifi className="h-4 w-4 text-emerald-600" />
          ) : testResult && !testResult.success ? (
            <WifiOff className="h-4 w-4 text-red-500" />
          ) : (
            <Wifi className="h-4 w-4" />
          )}
          {testing ? 'Probando...' : 'Probar Conexión'}
        </Button>

        <Button
          onClick={handleSave}
          disabled={saving || !wsUsername.trim()}
          className="flex items-center gap-2"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar Configuración Correos CR'}
        </Button>
      </div>

      {/* Info note */}
      <div className="rounded-lg border bg-muted/50 px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground/70">Nota:</strong> Los datos del remitente aparecerán impresos en cada guía de Correos CR.
          Asegúrese de que la dirección, código postal y teléfono sean correctos.
        </p>
      </div>
    </div>
  );
}
