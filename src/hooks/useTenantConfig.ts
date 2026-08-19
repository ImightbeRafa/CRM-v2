// Shared hook to load tenant display config (names + colors) from DB
// Used by all logistics pages to keep a consistent look

import { useState, useEffect } from 'react';

import { MANAGED_TENANTS } from '@/lib/logistics-managed-tenants';

export interface TenantConfig {
    id: string;
    name: string;
    color: string;
    defaultName: string;
    defaultColor: string;
}

export const FALLBACK_TENANT_CONFIG: TenantConfig[] = MANAGED_TENANTS.map((t) => ({
    id: t.id,
    name: t.defaultName,
    color: t.defaultColor,
    defaultName: t.defaultName,
    defaultColor: t.defaultColor,
}));

const CACHE_TTL_MS = 5 * 60_000;
let tenantConfigCache: { tenants: TenantConfig[]; timestamp: number } | null = null;
let tenantConfigInflight: Promise<TenantConfig[]> | null = null;

async function loadTenantConfig(): Promise<TenantConfig[]> {
    if (tenantConfigCache && Date.now() - tenantConfigCache.timestamp < CACHE_TTL_MS) {
        return tenantConfigCache.tenants;
    }
    if (tenantConfigInflight) return tenantConfigInflight;

    tenantConfigInflight = fetch('/api/logistics/tenant-config')
        .then(r => r.json())
        .then(d => {
            const tenants = d.tenants?.length ? d.tenants as TenantConfig[] : FALLBACK_TENANT_CONFIG;
            tenantConfigCache = { tenants, timestamp: Date.now() };
            return tenants;
        })
        .catch(() => FALLBACK_TENANT_CONFIG)
        .finally(() => {
            tenantConfigInflight = null;
        });

    return tenantConfigInflight;
}

export function useTenantConfig() {
    const [tenants, setTenants] = useState<TenantConfig[]>(
        tenantConfigCache?.tenants ?? FALLBACK_TENANT_CONFIG
    );
    const [loaded, setLoaded] = useState(Boolean(tenantConfigCache));

    useEffect(() => {
        let cancelled = false;
        loadTenantConfig()
            .then((next) => {
                if (!cancelled) setTenants(next);
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const byId = Object.fromEntries(tenants.map(t => [t.id, t]));

    function getTenantName(tenantId: string): string {
        return byId[tenantId]?.name ?? tenantId.slice(0, 8);
    }
    function getTenantColor(tenantId: string): string {
        return byId[tenantId]?.color ?? '#6c63ff';
    }

    return { tenants, loaded, getTenantName, getTenantColor };
}
