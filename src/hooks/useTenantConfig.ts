// Shared hook to load tenant display config (names + colors) from DB
// Used by all logistics pages to keep a consistent look

import { useState, useEffect } from 'react';

export interface TenantConfig {
    id: string;
    name: string;
    color: string;
    defaultName: string;
    defaultColor: string;
}

export const FALLBACK_TENANT_CONFIG: TenantConfig[] = [
    { id: 'cmh32z0ol0000k004hvx9tg3p', name: 'WhatASheet CR', color: '#6c63ff', defaultName: 'WhatASheet CR', defaultColor: '#6c63ff' },
    { id: 'cmhsibjue0004js04gie724nx', name: 'DeepSleep', color: '#3b82f6', defaultName: 'DeepSleep', defaultColor: '#3b82f6' },
    { id: 'cmhutd1th0000jp04oqibtz54', name: 'WAS CR', color: '#22c55e', defaultName: 'WAS CR', defaultColor: '#22c55e' },
    { id: 'cmigornmw0000lb04kl75262e', name: 'Kroma Lab', color: '#f59e0b', defaultName: 'Kroma Lab', defaultColor: '#f59e0b' },
    { id: 'cmjdabz4d0000il04dyc5qmcc', name: 'SimplePatch', color: '#ef4444', defaultName: 'SimplePatch', defaultColor: '#ef4444' },
    { id: 'cmln5u7k70000ld042qify2og', name: 'DeepCLean', color: '#a855f7', defaultName: 'DeepCLean', defaultColor: '#a855f7' },
    { id: 'cmh44aerw0006vijg0640vfl0', name: 'PeterTesting', color: '#06b6d4', defaultName: 'PeterTesting', defaultColor: '#06b6d4' },
];

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
