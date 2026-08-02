import { NextRequest, NextResponse } from 'next/server';
import { guardFinanceApi } from '@/lib/finance-auth';
import { parseFinanceDateRange, type FinanceDateRange } from '@/lib/finance-dates';
import {
  getFinanceOrdersPage,
  parseFinanceOrdersLimit,
  resolveFinanceOrdersTenant,
} from '@/lib/finance-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/v1/orders
 *
 * Period bootstrap:
 *   ?brand=deepsleep|bloom&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * Incremental changes:
 *   ?brand=deepsleep|bloom&updatedSince=ISO-8601
 *
 * Optional: cursor, limit (max 250), needsManualAssignment=1
 */
export async function GET(req: NextRequest) {
  const guard = await guardFinanceApi(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const tenantResult = resolveFinanceOrdersTenant(url.searchParams.get('brand'));
  if (!tenantResult.ok) {
    return NextResponse.json({ error: tenantResult.error }, { status: 400 });
  }

  const updatedSinceRaw = url.searchParams.get('updatedSince')?.trim() || null;
  const dateFromRaw = url.searchParams.get('dateFrom');
  const dateToRaw = url.searchParams.get('dateTo');
  const hasPeriodParams = Boolean(dateFromRaw || dateToRaw);
  const hasChangesParam = Boolean(updatedSinceRaw);

  if (hasPeriodParams && hasChangesParam) {
    return NextResponse.json(
      { error: 'Use either dateFrom/dateTo (period) or updatedSince (changes), not both' },
      { status: 400 },
    );
  }

  let mode: 'period' | 'changes';
  let range: FinanceDateRange | null = null;
  let updatedSince: Date | null = null;

  if (hasChangesParam) {
    mode = 'changes';
    const parsed = new Date(updatedSinceRaw!);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'updatedSince must be a valid ISO-8601 timestamp' },
        { status: 400 },
      );
    }
    updatedSince = parsed;
  } else {
    mode = 'period';
    const parsed = parseFinanceDateRange(dateFromRaw, dateToRaw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    range = parsed.range;
  }

  const needsManualAssignmentOnly =
    url.searchParams.get('needsManualAssignment') === '1' ||
    url.searchParams.get('needsManualAssignment') === 'true';

  try {
    const result = await getFinanceOrdersPage({
      tenant: tenantResult.tenant,
      mode,
      range,
      updatedSince,
      cursor: url.searchParams.get('cursor'),
      limit: parseFinanceOrdersLimit(url.searchParams.get('limit')),
      needsManualAssignmentOnly,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[finance/v1/orders]', error);
    return NextResponse.json({ error: 'Failed to fetch finance orders' }, { status: 500 });
  }
}
