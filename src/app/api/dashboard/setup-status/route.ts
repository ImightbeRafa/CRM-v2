import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';

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
}

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = token.tenantId as string;
    const prisma = getTenantPrisma(tenantId);

    const [tenant, statusCount, inventoryCount] = await Promise.all([
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
        href: '/config?tab=profile',
      },
      {
        id: 'order-statuses',
        label: 'Estados de Pedidos',
        description: 'Define el flujo de trabajo para tus órdenes',
        completed: statusCount > 0,
        href: '/config?tab=statuses',
      },
      {
        id: 'inventory',
        label: 'Inventario',
        description: 'Agrega tus productos al inventario',
        completed: inventoryCount > 0,
        href: '/config?tab=inventory',
      },
    ];

    const completedCount = items.filter((i) => i.completed).length;

    const response: SetupStatusResponse = {
      allCompleted: completedCount === items.length,
      completedCount,
      totalCount: items.length,
      items,
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
