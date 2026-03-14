'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { 
  Building2, 
  Phone, 
  Globe, 
  MapPin, 
  Save, 
  Loader2,
  CheckCircle2,
  ShoppingCart,
  BarChart3,
  Truck,
  Sparkles,
} from 'lucide-react';
import type { WizardStepProps } from '../SetupWizard';

const CR_PROVINCES = [
  'San José', 'Alajuela', 'Cartago', 'Heredia',
  'Guanacaste', 'Puntarenas', 'Limón',
];

const FEATURES = [
  { icon: ShoppingCart, text: 'Gestión de pedidos con Kanban' },
  { icon: Truck, text: 'Envíos con Correos de Costa Rica' },
  { icon: BarChart3, text: 'Estadísticas y reportes en tiempo real' },
  { icon: Sparkles, text: 'Asistente IA para tu negocio' },
];

export function WelcomeBusinessStep({ markCompleted, markUnsavedChanges }: WizardStepProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    businessName: '',
    phone: '',
    country: 'CR',
    province: '',
  });
  const [initial, setInitial] = useState(form);

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    const changed = JSON.stringify(form) !== JSON.stringify(initial);
    markUnsavedChanges(changed);
  }, [form, initial, markUnsavedChanges]);

  const loadProfile = async () => {
    try {
      const res = await fetch('/api/tenant/profile', { credentials: 'include' });
      const data = await res.json();
      if (data.profile) {
        const loaded = {
          businessName: data.profile.businessName || data.profile.name || '',
          phone: data.profile.phone || '',
          country: data.profile.country || 'CR',
          province: data.profile.province || '',
        };
        setForm(loaded);
        setInitial(loaded);
        if (loaded.businessName && loaded.phone) {
          markCompleted();
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!form.businessName.trim() || !form.phone.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          phone: form.phone.trim(),
          country: form.country,
          province: form.province,
        }),
      });
      if (res.ok) {
        setInitial(form);
        markCompleted();
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">¡Bienvenido a BetsyCRM!</h2>
        <p className="text-blue-100 mb-4">
          En pocos minutos tendrás todo configurado para empezar a gestionar tus pedidos.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <f.icon className="h-4 w-4 text-blue-200 flex-shrink-0" />
              <span className="text-blue-50">{f.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="grid gap-5">
        <div>
          <Label htmlFor="businessName" className="flex items-center gap-2 mb-1.5">
            <Building2 className="h-4 w-4 text-gray-500" />
            Nombre del Negocio <span className="text-red-500">*</span>
          </Label>
          <Input
            id="businessName"
            value={form.businessName}
            onChange={e => setForm(prev => ({ ...prev, businessName: e.target.value }))}
            placeholder="Ej: Mi Tienda S.A."
            className="h-11"
          />
        </div>

        <div>
          <Label htmlFor="phone" className="flex items-center gap-2 mb-1.5">
            <Phone className="h-4 w-4 text-gray-500" />
            Teléfono <span className="text-red-500">*</span>
          </Label>
          <Input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
            placeholder="Ej: 8888-8888"
            className="h-11"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="country" className="flex items-center gap-2 mb-1.5">
              <Globe className="h-4 w-4 text-gray-500" />
              País
            </Label>
            <Select value={form.country} onValueChange={v => setForm(prev => ({ ...prev, country: v }))}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CR">Costa Rica</SelectItem>
                <SelectItem value="PA">Panamá</SelectItem>
                <SelectItem value="NI">Nicaragua</SelectItem>
                <SelectItem value="GT">Guatemala</SelectItem>
                <SelectItem value="SV">El Salvador</SelectItem>
                <SelectItem value="HN">Honduras</SelectItem>
                <SelectItem value="OTHER">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.country === 'CR' && (
            <div>
              <Label htmlFor="province" className="flex items-center gap-2 mb-1.5">
                <MapPin className="h-4 w-4 text-gray-500" />
                Provincia
              </Label>
              <Select value={form.province} onValueChange={v => setForm(prev => ({ ...prev, province: v }))}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {CR_PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={saving || !form.businessName.trim() || !form.phone.trim()}
        className="w-full h-12 text-base"
      >
        {saving ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>
        ) : saved ? (
          <><CheckCircle2 className="h-4 w-4 mr-2" />¡Guardado!</>
        ) : (
          <><Save className="h-4 w-4 mr-2" />Guardar y Continuar</>
        )}
      </Button>
    </div>
  );
}
