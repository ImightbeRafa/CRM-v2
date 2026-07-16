import { NextRequest, NextResponse } from 'next/server';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { listConfirmedRetiros } from '@/lib/retiro-stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/logistics/retiros/history?limit=100
export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get('limit') || 100);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
    const items = await listConfirmedRetiros(limit);
    return NextResponse.json({ items });
  } catch (error) {
    console.error('[retiros/history GET]', error);
    return NextResponse.json({ error: 'No se pudo cargar el historial de retiros' }, { status: 500 });
  }
}
