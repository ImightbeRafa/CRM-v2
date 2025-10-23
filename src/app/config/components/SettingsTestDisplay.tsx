'use client';

import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';

export function SettingsTestDisplay() {
  const { settings, formatCurrency } = useTenantSettings();
  
  return (
    <div className="fixed top-4 right-4 z-50 bg-purple-100 border-2 border-purple-600 rounded-lg p-3 text-xs">
      <p className="font-bold text-purple-900 mb-1">🧪 Settings Test</p>
      <p><strong>Currency:</strong> {settings.currency}</p>
      <p><strong>Symbol:</strong> {settings.currencySymbol}</p>
      <p><strong>Language:</strong> {settings.language}</p>
      <p><strong>Test:</strong> {formatCurrency(10000)}</p>
    </div>
  );
}

