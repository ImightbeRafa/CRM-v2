'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { useToast } from '@/app/hooks/use-toast';
import { 
  Settings,
  DollarSign,
  Globe,
  Save,
  Loader2
} from 'lucide-react';

interface Currency {
  code: string;
  symbol: string;
  name: string;
  locale: string;
}

const CURRENCIES: Currency[] = [
  { code: 'CRC', symbol: '₡', name: 'Colón Costarricense', locale: 'es-CR' },
  { code: 'USD', symbol: '$', name: 'Dólar Estadounidense', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'es-ES' },
  { code: 'MXN', symbol: '$', name: 'Peso Mexicano', locale: 'es-MX' },
  { code: 'COP', symbol: '$', name: 'Peso Colombiano', locale: 'es-CO' },
  { code: 'ARS', symbol: '$', name: 'Peso Argentino', locale: 'es-AR' },
  { code: 'CLP', symbol: '$', name: 'Peso Chileno', locale: 'es-CL' },
  { code: 'PEN', symbol: 'S/', name: 'Sol Peruano', locale: 'es-PE' },
  { code: 'BRL', symbol: 'R$', name: 'Real Brasileño', locale: 'pt-BR' },
  { code: 'GTQ', symbol: 'Q', name: 'Quetzal Guatemalteco', locale: 'es-GT' },
  { code: 'HNL', symbol: 'L', name: 'Lempira Hondureño', locale: 'es-HN' },
  { code: 'NIO', symbol: 'C$', name: 'Córdoba Nicaragüense', locale: 'es-NI' },
  { code: 'PAB', symbol: 'B/.', name: 'Balboa Panameño', locale: 'es-PA' },
  { code: 'DOP', symbol: 'RD$', name: 'Peso Dominicano', locale: 'es-DO' },
];

export function GeneralSettings() {
  const [currency, setCurrency] = useState<Currency>(CURRENCIES[0]); // Default to CRC
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/config/settings');
      const json = await res.json();
      
      if (json.status === 'success' && json.data?.currency) {
        const savedCurrency = CURRENCIES.find(c => c.code === json.data.currency);
        if (savedCurrency) {
          setCurrency(savedCurrency);
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: currency.code,
          currencySymbol: currency.symbol,
          locale: currency.locale
        })
      });

      const json = await res.json();
      
      if (json.status === 'success') {
        toast({
          title: "✅ Configuración guardada",
          description: `Moneda actualizada a ${currency.name}`
        });
      } else {
        throw new Error(json.error || 'Error al guardar configuración');
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo guardar la configuración"
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Cargando configuración...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 rounded-lg">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-2xl text-gray-900">
                Configuración General
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Configura los ajustes básicos de tu tienda
              </p>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Currency Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-gray-700" />
            Moneda de la Tienda
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            Selecciona la moneda que utilizarás para productos, envíos y órdenes
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Currency Display */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-6 rounded-lg border-2 border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Moneda Actual</p>
                <div className="flex items-center gap-3">
                  <span className="text-4xl font-bold text-green-700">{currency.symbol}</span>
                  <div>
                    <p className="text-xl font-semibold text-gray-900">{currency.name}</p>
                    <p className="text-sm text-gray-600">{currency.code}</p>
                  </div>
                </div>
              </div>
              <Badge className="bg-green-600 text-white px-4 py-2 text-lg">
                <Globe className="w-4 h-4 mr-2" />
                {currency.locale}
              </Badge>
            </div>
          </div>

          {/* Currency Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Seleccionar Moneda
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {CURRENCIES.map((curr) => (
                <button
                  key={curr.code}
                  onClick={() => setCurrency(curr)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    currency.code === curr.code
                      ? 'border-blue-600 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold">{curr.symbol}</span>
                    <div className="text-left flex-1">
                      <p className="font-semibold text-gray-900">{curr.code}</p>
                      <p className="text-xs text-gray-600">{curr.name}</p>
                    </div>
                    {currency.code === curr.code && (
                      <Badge className="bg-blue-600 text-white">
                        ✓
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Example Preview */}
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">Vista Previa</p>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Producto básico:</span>
                <span className="font-semibold">{currency.symbol}10,000</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Envío:</span>
                <span className="font-semibold">{currency.symbol}2,500</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-sm font-semibold text-gray-900">Total:</span>
                <span className="font-bold text-green-600 text-lg">{currency.symbol}12,500</span>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6"
              size="lg"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Guardar Configuración
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Globe className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-blue-900 mb-1">ℹ️ Información Importante</p>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• La moneda se aplica a todos los productos, envíos y órdenes</li>
                <li>• Los precios existentes no se convertirán automáticamente</li>
                <li>• Puedes cambiar la moneda en cualquier momento</li>
                <li>• Esta configuración es independiente de la facturación de suscripción</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default GeneralSettings;

