import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const now = new Date();
    const period =
      url.searchParams.get('period') ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const botWhere: any = {};
    if (tenantId) botWhere.tenantId = tenantId;

    const usageWhere: any = { period };
    if (tenantId) usageWhere.tenantId = tenantId;

    const [botSessions, usageLogs, totalActiveSessions] = await Promise.all([
      prisma.botSession.findMany({
        where: botWhere,
        select: {
          id: true,
          platform: true,
          tenantId: true,
          isActive: true,
          connectedAt: true,
          tenant: { select: { name: true } },
        },
        orderBy: { connectedAt: 'desc' },
      }),

      prisma.usageLog.findMany({
        where: usageWhere,
        select: {
          tenantId: true,
          metric: true,
          count: true,
          period: true,
          tenant: { select: { name: true } },
        },
      }),

      prisma.botSession.count({ where: { isActive: true } }),
    ]);

    const tenantBots: Record<
      string,
      {
        tenantName: string;
        telegram: { active: number; total: number };
        whatsapp: { active: number; total: number };
      }
    > = {};

    for (const s of botSessions) {
      if (!tenantBots[s.tenantId]) {
        tenantBots[s.tenantId] = {
          tenantName: s.tenant?.name || s.tenantId,
          telegram: { active: 0, total: 0 },
          whatsapp: { active: 0, total: 0 },
        };
      }
      const bucket = s.platform === 'telegram' ? 'telegram' : 'whatsapp';
      tenantBots[s.tenantId][bucket].total += 1;
      if (s.isActive) tenantBots[s.tenantId][bucket].active += 1;
    }

    const tenantUsage: Record<string, { tenantName: string; metrics: Record<string, number> }> = {};
    for (const u of usageLogs) {
      if (!tenantUsage[u.tenantId]) {
        tenantUsage[u.tenantId] = {
          tenantName: u.tenant?.name || u.tenantId,
          metrics: {},
        };
      }
      tenantUsage[u.tenantId].metrics[u.metric] = u.count;
    }

    return NextResponse.json({
      period,
      totalActiveSessions,
      totalSessions: botSessions.length,
      botsByTenant: Object.entries(tenantBots).map(([tid, data]) => ({
        tenantId: tid,
        ...data,
      })),
      usageByTenant: Object.entries(tenantUsage).map(([tid, data]) => ({
        tenantId: tid,
        ...data,
      })),
    });
  } catch (e: any) {
    console.error('[admin/usage GET]', e.message);
    return NextResponse.json({ error: 'Failed to fetch usage data' }, { status: 500 });
  }
}
