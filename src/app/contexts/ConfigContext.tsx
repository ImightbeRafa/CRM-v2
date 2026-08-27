'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';

type FetchState<T> = { data: T; loading: boolean; error: string | null };
type ConfigKeys = 'statuses' | 'businessInfoFields' | 'fields' | 'sellers' | 'shipping' | 'inventory' | 'optionSets';
type ConfigContextType = {
  getState: <T = any[]>(key: ConfigKeys) => FetchState<T>;
  refresh: (key?: ConfigKeys | ConfigKeys[]) => Promise<void>;
};

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);
const RESOURCE_ENDPOINTS: Record<ConfigKeys, string> = {
  statuses: '/api/config/status', businessInfoFields: '/api/config/business-info', fields: '/api/config/fields',
  sellers: '/api/config/sellers', shipping: '/api/config/shipping', inventory: '/api/config/inventory', optionSets: '/api/config/option-sets',
};
const CONFIG_KEYS = Object.keys(RESOURCE_ENDPOINTS) as ConfigKeys[];
const CACHE_TTL_MS = 5 * 60_000;
const resourceCache = new Map<string, { data: any[]; expiresAt: number }>();

function blankState(loading = false): Record<ConfigKeys, FetchState<any[]>> {
  return CONFIG_KEYS.reduce((result, key) => {
    result[key] = { data: [], loading, error: null };
    return result;
  }, {} as Record<ConfigKeys, FetchState<any[]>>);
}

function keysForPath(pathname: string): ConfigKeys[] {
  if (pathname.startsWith('/produccion')) return ['fields', 'businessInfoFields'];
  if (pathname.startsWith('/ventas')) return ['statuses', 'fields', 'sellers', 'shipping', 'businessInfoFields', 'optionSets'];
  if (pathname.startsWith('/config')) return ['statuses', 'fields', 'sellers', 'shipping', 'businessInfoFields', 'optionSets'];
  return [];
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname() || '';
  const tenantId = session?.user?.currentTenant?.id || session?.user?.tenantId || null;
  const activeTenantRef = useRef<string | null>(tenantId);
  const [stateTenantId, setStateTenantId] = useState<string | null>(tenantId);
  const [states, setStates] = useState<Record<ConfigKeys, FetchState<any[]>>>(() => blankState());

  useEffect(() => {
    activeTenantRef.current = tenantId;
    setStateTenantId(tenantId);
    setStates(blankState());
  }, [tenantId]);

  const updateState = useCallback((tenantKey: string, key: ConfigKeys, update: Partial<FetchState<any[]>>) => {
    if (activeTenantRef.current !== tenantKey) return;
    setStates(previous => ({ ...previous, [key]: { ...previous[key], ...update } }));
  }, []);

  const fetchResource = useCallback(async (tenantKey: string, key: ConfigKeys, signal?: AbortSignal, force = false) => {
    const cacheKey = `${tenantKey}:${key}`;
    const cached = resourceCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now()) {
      updateState(tenantKey, key, { data: cached.data, loading: false, error: null });
      return;
    }
    updateState(tenantKey, key, { loading: true, error: null });
    try {
      const response = await fetch(RESOURCE_ENDPOINTS[key], { credentials: 'include', signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const json = await response.json();
      const data = json.status === 'success' && Array.isArray(json.data) ? json.data : [];
      if (activeTenantRef.current !== tenantKey) return;
      resourceCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      updateState(tenantKey, key, { data, loading: false, error: json.status === 'success' ? null : json.error || 'Failed to load data' });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error(`[ConfigContext] Failed to load ${key}:`, error);
      updateState(tenantKey, key, { loading: false, error: 'Failed to load data' });
    }
  }, [updateState]);

  useEffect(() => {
    if (status !== 'authenticated' || !tenantId) return;
    const controller = new AbortController();
    const keys = keysForPath(pathname);
    for (const key of keys) void fetchResource(tenantId, key, controller.signal);
    return () => controller.abort();
  }, [fetchResource, pathname, status, tenantId]);

  const refresh = useCallback(async (keys?: ConfigKeys | ConfigKeys[]) => {
    if (!tenantId) return;
    const requested = Array.isArray(keys) ? keys : keys ? [keys] : keysForPath(pathname);
    await Promise.all(requested.map(key => fetchResource(tenantId, key, undefined, true)));
  }, [fetchResource, pathname, tenantId]);

  const getState = useCallback(<T,>(key: ConfigKeys): FetchState<T> => {
    if (status !== 'authenticated' || !tenantId) return { data: [] as T, loading: false, error: null };
    if (stateTenantId !== tenantId) return { data: [] as T, loading: true, error: null };
    return states[key] as FetchState<T>;
  }, [stateTenantId, states, status, tenantId]);
  const value = useMemo(() => ({ getState, refresh }), [getState, refresh]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (!context) throw new Error('useConfig must be used within a ConfigProvider');
  return context;
}
