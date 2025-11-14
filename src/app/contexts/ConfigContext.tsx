'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type FetchState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

type ConfigKeys =
  | 'statuses'
  | 'businessInfoFields'
  | 'fields'
  | 'sellers'
  | 'shipping'
  | 'inventory'
  | 'optionSets';

type ConfigData = Record<ConfigKeys, any[]>;

type ConfigContextType = {
  getState: <T = any[]>(key: ConfigKeys) => FetchState<T>;
  refresh: (key?: ConfigKeys | ConfigKeys[]) => Promise<void>;
};

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

const DEFAULT_STATE: FetchState<any[]> = {
  data: [],
  loading: true,
  error: null,
};

const RESOURCE_ENDPOINTS: Record<ConfigKeys, string> = {
  statuses: '/api/config/status',
  businessInfoFields: '/api/config/business-info',
  fields: '/api/config/fields',
  sellers: '/api/config/sellers',
  shipping: '/api/config/shipping',
  inventory: '/api/config/inventory',
  optionSets: '/api/config/option-sets',
};

const HIGH_PRIORITY_KEYS: ConfigKeys[] = [
  'statuses',
  'fields',
  'sellers',
  'shipping',
  'businessInfoFields',
  'optionSets',
];

const LOW_PRIORITY_KEYS: ConfigKeys[] = ['inventory'];

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<ConfigKeys, FetchState<any[]>>>(() => {
    return {
      statuses: { ...DEFAULT_STATE },
      businessInfoFields: { ...DEFAULT_STATE },
      fields: { ...DEFAULT_STATE },
      sellers: { ...DEFAULT_STATE },
      shipping: { ...DEFAULT_STATE },
      inventory: { ...DEFAULT_STATE },
      optionSets: { ...DEFAULT_STATE },
    };
  });

  const updateState = (key: ConfigKeys, updater: Partial<FetchState<any[]>>) => {
    setStates((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updater,
      },
    }));
  };

  const fetchResource = async (key: ConfigKeys, signal?: AbortSignal) => {
    const endpoint = RESOURCE_ENDPOINTS[key];
    if (!endpoint) return;

    try {
      updateState(key, { loading: true, error: null });

      const response = await fetch(endpoint, {
        credentials: 'include',
        signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const json = await response.json();
      if (json.status === 'success') {
        updateState(key, { data: json.data || [] });
      } else {
        updateState(key, { data: [], error: json.error || 'Failed to load data' });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error(`[ConfigContext] Failed to load ${key}:`, error);
      updateState(key, { error: 'Failed to load data' });
    } finally {
      updateState(key, { loading: false });
    }
  };

  useEffect(() => {
    const abortController = new AbortController();

    HIGH_PRIORITY_KEYS.forEach((key) => {
      fetchResource(key, abortController.signal);
    });

    return () => abortController.abort();
  }, []);

  const refresh = async (keys?: ConfigKeys | ConfigKeys[]) => {
    const targetKeys = Array.isArray(keys)
      ? keys
      : keys
      ? [keys]
      : [...HIGH_PRIORITY_KEYS, ...LOW_PRIORITY_KEYS];

    await Promise.all(targetKeys.map((key) => fetchResource(key)));
  };

  const getState = <T,>(key: ConfigKeys): FetchState<T> => {
    return states[key] as FetchState<T>;
  };

  return (
    <ConfigContext.Provider value={{ getState, refresh }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
