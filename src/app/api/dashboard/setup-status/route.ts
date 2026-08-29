import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { authenticateAPI } from '@/lib/auth-helpers';
import { readTenantUiReadiness } from '@/lib/feature-flags';
import { readSetupProgress, type SetupProgressView } from '@/lib/setup-progress';

export const dynamic = 'force-dynamic';

export interface SetupStatusItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  href: string;
}

export interface SetupStatusResponse {
  allCompleted: boolean;
  completedCount: number;
  totalCount: number;
  items: SetupStatusItem[];
  guide: {
    enabled: boolean;
    progress: SetupProgressView | null;
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;

    const tenantId = auth.tenantId;
    const prisma = getTenantPrisma(tenantId);

    const [tenant, statusCount, inventoryCount, readiness] = await Promise.all([
      globalPrisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          phone: true,
          country: true,
          businessName: true,
          profileCompleted: true,
        } as any,
      }),
      prisma.orderStatus.count({ where: { isActive: true } }),
      prisma.inventoryItem.count({ where: { isActive: true } }),
      readTenantUiReadiness(tenantId),
    ]);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const t = tenant as any;

    const items: SetupStatusItem[] = [
      {
        id: 'business-profile',
        label: 'Perfil del Negocio',
        description: 'Configura el nombre, teléfono y ubicación de tu negocio',
        completed: Boolean(t.phone && t.country),
        href: readiness.setupGuide
          ? '/setup-wizard?step=welcome-business&returnTo=%2Fdashboard'
          : '/config?tab=profile',
      },
      {
        id: 'order-statuses',
        label: 'Estados de Pedidos',
        description: 'Define el flujo de trabajo para tus órdenes',
        completed: statusCount > 0,
        href: readiness.setupGuide
          ? '/setup-wizard?step=order-status&returnTo=%2Fdashboard'
          : '/config?tab=statuses',
      },
      {
        id: 'inventory',
        label: 'Inventario',
        description: 'Agrega tus productos al inventario',
        completed: inventoryCount > 0,
        href: readiness.setupGuide
          ? '/setup-wizard?step=first-product&returnTo=%2Fdashboard'
          : '/config?tab=inventory',
      },
    ];

    const completedCount = items.filter((i) => i.completed).length;

    let guideProgress: SetupProgressView | null = null;
    let guideEnabled = readiness.setupGuide;
    if (guideEnabled) {
      try {
        guideProgress = await readSetupProgress(tenantId);
      } catch (error) {
        // Code can deploy before the separately approved additive SQL. In that
        // state the legacy checklist remains usable and no setup write occurs.
        if (String((error as { code?: unknown })?.code || '') === 'P2021') guideEnabled = false;
        else throw error;
      }
    }
    if (!guideEnabled) {
      items[0].href = '/config?tab=profile';
      items[1].href = '/config?tab=statuses';
      items[2].href = '/config?tab=inventory';
    }

    const response: SetupStatusResponse = {
      allCompleted: completedCount === items.length,
      completedCount,
      totalCount: items.length,
      items,
      guide: {
        enabled: guideEnabled,
        progress: guideProgress,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Setup Status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch setup status' },
      { status: 500 },
    );
  }
}
