'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';

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
const CACHE_TTL_MS = 5 * 60_000;

const UNAUTHENTICATED_STATE: FetchState<any[]> = {
  data: [],
  loading: false,
  error: null,
};

const resourceCache = new Map<ConfigKeys, { data: any[]; timestamp: number }>();

function configKeysForPath(pathname: string | null): ConfigKeys[] {
  if (!pathname) return [];
  if (pathname === '/produccion' || pathname.startsWith('/produccion/')) {
    return ['statuses', 'fields', 'businessInfoFields'];
  }
  if (pathname === '/ventas' || pathname.startsWith('/ventas/')) {
    return HIGH_PRIORITY_KEYS;
  }
  if (pathname === '/config' || pathname.startsWith('/config/')) {
    return HIGH_PRIORITY_KEYS;
  }
  return [];
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname();
  const isAuthenticated = status === 'authenticated';

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

  const updateState = useCallback((key: ConfigKeys, updater: Partial<FetchState<any[]>>) => {
    setStates((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updater,
      },
    }));
  }, []);

  const fetchResource = useCallback(async (key: ConfigKeys, signal?: AbortSignal) => {
    const endpoint = RESOURCE_ENDPOINTS[key];
    if (!endpoint) return;

    const cached = resourceCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      updateState(key, { data: cached.data, loading: false, error: null });
      return;
    }

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
        const data = json.data || [];
        resourceCache.set(key, { data, timestamp: Date.now() });
        updateState(key, { data });
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
  }, [updateState]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const keys = configKeysForPath(pathname);
    if (keys.length === 0) return;

    const abortController = new AbortController();
    keys.forEach((key) => {
      fetchResource(key, abortController.signal);
    });

    return () => abortController.abort();
  }, [fetchResource, isAuthenticated, pathname]);

  const refresh = useCallback(async (keys?: ConfigKeys | ConfigKeys[]) => {
    const targetKeys = Array.isArray(keys)
      ? keys
      : keys
      ? [keys]
      : [...HIGH_PRIORITY_KEYS, ...LOW_PRIORITY_KEYS];

    targetKeys.forEach((key) => resourceCache.delete(key));
    await Promise.all(targetKeys.map((key) => fetchResource(key)));
  }, [fetchResource]);

  const getState = useCallback(<T,>(key: ConfigKeys): FetchState<T> => {
    if (!isAuthenticated) return UNAUTHENTICATED_STATE as FetchState<T>;
    return states[key] as FetchState<T>;
  }, [states, isAuthenticated]);

  const value = useMemo(() => ({ getState, refresh }), [getState, refresh]);

  return (
    <ConfigContext.Provider value={value}>
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
