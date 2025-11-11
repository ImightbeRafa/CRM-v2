'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ConfigData {
  statuses: Array<{key: string; label: string; color: string | null}>;
  businessInfoFields: any[];
  fields: any[];
  sellers: any[];
  shipping: any[];
  inventory: any[];
  optionSets: any[];
}

interface ConfigContextType {
  config: ConfigData;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

const initialConfig: ConfigData = {
  statuses: [],
  businessInfoFields: [],
  fields: [],
  sellers: [],
  shipping: [],
  inventory: [],
  optionSets: [],
};

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfigData>(initialConfig);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      // Fetch config data in batches to avoid overwhelming database connections
      // Batch 1: Critical config
      const [statusRes, businessRes] = await Promise.all([
        fetch('/api/config/status', { credentials: 'include', signal }),
        fetch('/api/config/business-info', { credentials: 'include', signal }),
      ]);

      const [statusData, businessData] = await Promise.all([
        statusRes.json(),
        businessRes.json(),
      ]);

      // Batch 2: Form-related config
      const [fieldsRes, sellersRes, shippingRes] = await Promise.all([
        fetch('/api/config/fields', { credentials: 'include', signal }),
        fetch('/api/config/sellers', { credentials: 'include', signal }),
        fetch('/api/config/shipping', { credentials: 'include', signal }),
      ]);

      const [fieldsData, sellersData, shippingData] = await Promise.all([
        fieldsRes.json(),
        sellersRes.json(),
        shippingRes.json(),
      ]);

      // Batch 3: Optional config
      const [inventoryRes, optionSetsRes] = await Promise.all([
        fetch('/api/config/inventory', { credentials: 'include', signal }),
        fetch('/api/config/option-sets', { credentials: 'include', signal }),
      ]);

      const [inventoryData, optionSetsData] = await Promise.all([
        inventoryRes.json(),
        optionSetsRes.json(),
      ]);

      setConfig({
        statuses: statusData.status === 'success' ? statusData.data : [],
        businessInfoFields: businessData.status === 'success' ? businessData.data : [],
        fields: fieldsData.status === 'success' ? fieldsData.data : [],
        sellers: sellersData.status === 'success' ? sellersData.data : [],
        shipping: shippingData.status === 'success' ? shippingData.data : [],
        inventory: inventoryData.status === 'success' ? inventoryData.data : [],
        optionSets: optionSetsData.status === 'success' ? optionSetsData.data : [],
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[ConfigContext] Load aborted');
        return;
      }
      console.error('[ConfigContext] Error loading config:', err);
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const abortController = new AbortController();
    loadConfig(abortController.signal);
    
    return () => {
      abortController.abort();
    };
  }, []);

  const refresh = async () => {
    await loadConfig();
  };

  return (
    <ConfigContext.Provider value={{ config, loading, error, refresh }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
