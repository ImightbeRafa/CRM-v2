import { NextRequest, NextResponse } from 'next/server';
import { guardFinanceApi } from '@/lib/finance-auth';
import { parseFinanceDateRange } from '@/lib/finance-dates';
import { getFinancePayroll } from '@/lib/finance-payroll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/v1/payroll?dateFrom=&dateTo=
 * Per-employee payroll for the range (defaults to current CR week).
 * Global logistics workforce — not brand-split.
 */
export async function GET(req: NextRequest) {
  const guard = await guardFinanceApi(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const parsed = parseFinanceDateRange(
    url.searchParams.get('dateFrom'),
    url.searchParams.get('dateTo'),
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const payroll = await getFinancePayroll(parsed.range);
    return NextResponse.json({
      currency: 'CRC',
      ...payroll,
    });
  } catch (error) {
    console.error('[finance/v1/payroll]', error);
    return NextResponse.json({ error: 'Failed to fetch finance payroll' }, { status: 500 });
  }
}
