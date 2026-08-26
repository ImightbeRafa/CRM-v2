'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import {
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
} from 'lucide-react';

interface ShippingConfig {
  id: string;
  carrier: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  settings?: Record<string, any>;
}

export function ShippingConfigManagement() {
  const [loading, setLoading] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);

  const [senderName, setSenderName] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [senderZip, setSenderZip] = useState('');
  const [senderPhone, setSenderPhone] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [platformConfigured, setPlatformConfigured] = useState<boolean | null>(null);

  const buildSettings = useCallback(() => {
    const settings: Record<string, string> = {
      ws_sender_name: senderName.trim(),
      ws_sender_address: senderAddress.trim(),
      ws_sender_zip: senderZip.trim(),
      ws_sender_phone: senderPhone.trim(),
    };
    return settings;
  }, [senderName, senderAddress, senderZip, senderPhone]);

  useEffect(() => {
    loadConfig();
    checkPlatformStatus();
  }, []);

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
          setSenderName(s.ws_sender_name || '');
          setSenderAddress(s.ws_sender_address || '');
          setSenderZip(s.ws_sender_zip || '');
          setSenderPhone(s.ws_sender_phone || '');
        }
      }
    } catch (err) {
      console.error('Error loading Correos CR config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!senderName.trim()) return;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando configuración de Correos CR...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h2 className="text-2xl font-bold">Correos de Costa Rica</h2>
          {platformConfigured && (
            <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
              <CheckCircle className="h-3 w-3 mr-1" />
              Servicio Activo
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Configure los datos del remitente que aparecerán en cada guía generada.
          Las credenciales del Web Service son administradas a nivel de plataforma.
        </p>
      </div>

      {platformConfigured === false && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Las credenciales del Web Service de Correos CR no están configuradas a nivel de plataforma. Contacte al administrador.
        </div>
      )}

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
          onClick={handleSave}
          disabled={saving || !senderName.trim()}
          className="flex items-center gap-2"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar Datos del Remitente'}
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
