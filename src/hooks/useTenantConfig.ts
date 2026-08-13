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

export function useTenantConfig() {
    const [tenants, setTenants] = useState<TenantConfig[]>(FALLBACK_TENANT_CONFIG);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch('/api/logistics/tenant-config')
            .then(r => r.json())
            .then(d => { if (d.tenants?.length) { setTenants(d.tenants); } })
            .catch(() => {/* keep fallback */ })
            .finally(() => setLoaded(true));
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
