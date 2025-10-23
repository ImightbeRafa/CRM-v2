'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { useToast } from '@/app/hooks/use-toast';
import { useCurrentUser } from '@/app/hooks/useCurrentUser';
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';
import { 
  Settings,
  DollarSign,
  Globe,
  X,
  Check,
  Loader2
} from 'lucide-react';

interface Currency {
  code: string;
  symbol: string;
  name: string;
}

interface Language {
  code: string;
  name: string;
  flag: string;
}

interface CurrencyWithLocale extends Currency {
  locale: string;
}

const CURRENCIES: CurrencyWithLocale[] = [
  { code: 'CRC', symbol: '₡', name: 'Colón (CRC)', locale: 'es-CR' },
  { code: 'USD', symbol: '$', name: 'Dólar (USD)', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro (EUR)', locale: 'es-ES' },
  { code: 'MXN', symbol: '$', name: 'Peso MX', locale: 'es-MX' },
  { code: 'COP', symbol: '$', name: 'Peso CO', locale: 'es-CO' },
  { code: 'ARS', symbol: '$', name: 'Peso AR', locale: 'es-AR' },
  { code: 'BRL', symbol: 'R$', name: 'Real BR', locale: 'pt-BR' },
];

const LANGUAGES: Language[] = [
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
];

export function TenantSettingsPanel() {
  const { user } = useCurrentUser();
  const { refreshSettings } = useTenantSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [currency, setCurrency] = useState<Currency>(CURRENCIES[0]);
  const [language, setLanguage] = useState<Language>(LANGUAGES[0]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/config/settings');
      const json = await res.json();
      
      if (json.status === 'success' && json.data) {
        if (json.data.currency) {
          const savedCurrency = CURRENCIES.find(c => c.code === json.data.currency);
          if (savedCurrency) setCurrency(savedCurrency);
        }
        if (json.data.language) {
          const savedLanguage = LANGUAGES.find(l => l.code === json.data.language);
          if (savedLanguage) setLanguage(savedLanguage);
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
      console.log('💾 Saving settings:', {
        currency: currency.code,
        currencySymbol: currency.symbol,
        language: language.code
      });
      
      const res = await fetch('/api/config/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currency: currency.code,
          currencySymbol: currency.symbol,
          language: language.code,
          locale: currency.locale
        })
      });

      const json = await res.json();
      console.log('📥 Save response:', json);
      
      if (json.status === 'success') {
        toast({
          title: "✅ Configuración guardada",
          description: "Los cambios se aplicarán en toda la aplicación"
        });
        setIsOpen(false);
        
        // Refresh settings context
        console.log('🔄 Refreshing settings context...');
        await refreshSettings();
        
        // Reload page to apply language changes (for now - can be optimized later)
        console.log('🔄 Reloading page in 1 second...');
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        throw new Error(json.error || 'Error al guardar');
      }
    } catch (error) {
      console.error('❌ Save error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo guardar la configuración"
      });
    } finally {
      setSaving(false);
    }
  };

  // Debug: Log user info
  useEffect(() => {
    console.log('TenantSettingsPanel - User:', user);
    console.log('TenantSettingsPanel - User Role:', user?.role);
  }, [user]);

  useEffect(() => {
    loadSettings();
  }, []);

  // Only show for master users (OWNER role)
  const isMaster = user?.role === 'OWNER';
  
  // For now, show to all authenticated users for debugging
  if (!user) {
    return null; // Don't show if not logged in
  }

  return (
    <>
      {/* Floating Settings Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-40 p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-all hover:scale-110"
        title="Configuración de la tienda"
      >
        <Settings className="w-5 h-5" />
      </button>

      {/* Settings Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-50"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Panel */}
          <div className="fixed bottom-16 right-4 z-50 w-72 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  <h3 className="font-semibold text-sm">Configuración</h3>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-0.5 hover:bg-white/20 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="p-4 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              </div>
            ) : (
              <div className="p-3 space-y-3">
                {/* Currency Section */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-gray-600" />
                    <label className="text-xs font-semibold text-gray-700">Moneda</label>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CURRENCIES.map((curr) => (
                      <button
                        key={curr.code}
                        onClick={() => setCurrency(curr)}
                        className={`p-1.5 rounded border-2 text-xs font-medium transition-all ${
                          currency.code === curr.code
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-blue-300 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-base">{curr.symbol}</span>
                          <span className="text-xs">{curr.code}</span>
                          {currency.code === curr.code && (
                            <Check className="w-2.5 h-2.5" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-gray-200" />

                {/* Language Section */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Globe className="w-3.5 h-3.5 text-gray-600" />
                    <label className="text-xs font-semibold text-gray-700">Idioma</label>
                  </div>
                  <div className="space-y-1.5">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => setLanguage(lang)}
                        className={`w-full p-1.5 rounded border-2 text-xs font-medium transition-all flex items-center justify-between ${
                          language.code === lang.code
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-blue-300 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">{lang.flag}</span>
                          <span>{lang.name}</span>
                        </div>
                        {language.code === lang.code && (
                          <Check className="w-3 h-3" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-gray-200" />

                {/* Preview */}
                <div className="bg-gray-50 p-2 rounded">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-600">Ejemplo:</span>
                    <span className="font-bold">{currency.symbol}10,000</span>
                  </div>
                </div>

                {/* Save Button */}
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-700 h-8 text-xs"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Check className="w-3 h-3 mr-1.5" />
                      Guardar
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

