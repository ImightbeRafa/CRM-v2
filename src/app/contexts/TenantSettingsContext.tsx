'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

interface TenantSettings {
  currency: string;
  currencySymbol: string;
  language: string;
  locale: string;
}

interface TenantSettingsContextType {
  settings: TenantSettings;
  refreshSettings: () => Promise<void>;
  formatCurrency: (amount: number) => string;
}

const defaultSettings: TenantSettings = {
  currency: 'CRC',
  currencySymbol: '₡',
  language: 'es',
  locale: 'es-CR'
};

const TenantSettingsContext = createContext<TenantSettingsContextType>({
  settings: defaultSettings,
  refreshSettings: async () => {},
  formatCurrency: (amount: number) => `₡${amount.toLocaleString()}`
});

export function TenantSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<TenantSettings>(defaultSettings);
  const [isMounted, setIsMounted] = useState(true);

  const { status } = useSession();

  const loadSettings = async () => {
    try {
      console.log('🔄 Loading tenant settings...');
      const res = await fetch('/api/config/settings', {
        credentials: 'include'
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const json = await res.json();
      console.log('📥 Settings loaded:', json);
      
      if (json.status === 'success' && json.data) {
        const newSettings = {
          currency: json.data.currency || 'CRC',
          currencySymbol: json.data.currencySymbol || '₡',
          language: json.data.language || 'es',
          locale: json.data.locale || 'es-CR'
        };
        console.log('✅ Applying settings:', newSettings);
        if (isMounted) {
          setSettings(newSettings);
        }
      }
    } catch (error) {
      console.error('❌ Error loading tenant settings:', error);
      // Keep default settings on error - don't throw to prevent app crash
    }
  };

  useEffect(() => {
    // Only load settings if user is authenticated
    if (status === 'authenticated') {
      loadSettings();
    }
    
    return () => {
      setIsMounted(false);
    };
  }, [status]);

  const formatCurrency = (amount: number): string => {
    if (isNaN(amount)) return `${settings.currencySymbol}0`;
    
    // Format number with commas/dots based on locale
    const formatted = new Intl.NumberFormat(settings.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      useGrouping: true
    }).format(amount);
    
    // Return with currency symbol prefix
    return `${settings.currencySymbol}${formatted}`;
  };

  const value: TenantSettingsContextType = {
    settings,
    refreshSettings: loadSettings,
    formatCurrency
  };

  return (
    <TenantSettingsContext.Provider value={value}>
      {children}
    </TenantSettingsContext.Provider>
  );
}

export function useTenantSettings() {
  const context = useContext(TenantSettingsContext);
  if (!context) {
    throw new Error('useTenantSettings must be used within TenantSettingsProvider');
  }
  return context;
}

