import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = ['supabase', 'vercel', 'domain', 'hosting', 'api_service', 'salary', 'marketing', 'other'];
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period');

    let rows: any[];
    if (period) {
      if (!PERIOD_RE.test(period)) {
        return NextResponse.json({ error: 'Invalid period format. Use YYYY-MM.' }, { status: 400 });
      }
      rows = await prisma.$queryRaw<any[]>`
        SELECT id, category, label, amount, currency, period, notes, created_by, created_at, updated_at
        FROM lm_operational_costs
        WHERE period = ${period}
        ORDER BY created_at DESC
      `;
    } else {
      rows = await prisma.$queryRaw<any[]>`
        SELECT id, category, label, amount, currency, period, notes, created_by, created_at, updated_at
        FROM lm_operational_costs
        ORDER BY period DESC, created_at DESC
        LIMIT 200
      `;
    }

    const totalByCategory: Record<string, number> = {};
    let grandTotal = 0;
    for (const r of rows) {
      const amt = Number(r.amount);
      totalByCategory[r.category] = (totalByCategory[r.category] || 0) + amt;
      grandTotal += amt;
    }

    return NextResponse.json({ costs: rows, totalByCategory, grandTotal });
  } catch (e: any) {
    console.error('[admin/costs GET]', e.message);
    return NextResponse.json({ error: 'Failed to fetch costs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const userId = (token as any)?.sub || 'system';

    const body = await req.json();
    const { category, label, amount, currency, period, notes } = body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }
    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return NextResponse.json({ error: 'Label is required' }, { status: 400 });
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    }
    if (!period || !PERIOD_RE.test(period)) {
      return NextResponse.json({ error: 'Period is required in YYYY-MM format' }, { status: 400 });
    }

    const safeCurrency = (currency || 'USD').toUpperCase().slice(0, 3);
    const safeLabel = label.trim().slice(0, 200);
    const safeNotes = notes ? String(notes).slice(0, 2000) : null;

    const [row] = await prisma.$queryRaw<any[]>`
      INSERT INTO lm_operational_costs (category, label, amount, currency, period, notes, created_by)
      VALUES (${category}, ${safeLabel}, ${numAmount}, ${safeCurrency}, ${period}, ${safeNotes}, ${userId})
      RETURNING *
    `;

    return NextResponse.json({ cost: row }, { status: 201 });
  } catch (e: any) {
    console.error('[admin/costs POST]', e.message);
    return NextResponse.json({ error: 'Failed to create cost entry' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id || typeof id !== 'string' || id.length > 100) {
      return NextResponse.json({ error: 'Valid cost entry id required' }, { status: 400 });
    }

    const affected = await prisma.$executeRaw`
      DELETE FROM lm_operational_costs WHERE id = ${id}
    `;

    if (affected === 0) {
      return NextResponse.json({ error: 'Cost entry not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('[admin/costs DELETE]', e.message);
    return NextResponse.json({ error: 'Failed to delete cost entry' }, { status: 500 });
  }
}
