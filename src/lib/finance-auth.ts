import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createRateLimit, getClientIP, rateLimit } from '@/lib/rate-limit';

const financeRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  // Orders sync paginates; 60 / 15m supports month bootstraps without opening anonymous abuse.
  maxRequests: 60,
  identifier: 'finance-api',
});

// Valid-key callers only: generous ceiling so a full Bitácora sync (~50 calls) and a few
// manual re-syncs fit, while a leaked key still cannot hammer the DB unbounded.
const financeTrustedRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 600,
  identifier: 'finance-api-trusted',
});

function digestKey(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function getConfiguredFinanceKeys(): string[] {
  return [process.env.FINANCE_API_KEY, process.env.FINANCE_API_KEY_PREVIOUS]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length >= 24);
}

/**
 * Validate the shared finance API key.
 * Uses SHA-256 digests + timingSafeEqual so length leaks are minimized.
 * Fail-closed when no key is configured.
 */
export function validateFinanceApiKey(provided: string | null | undefined): boolean {
  if (!provided || typeof provided !== 'string') return false;
  const trimmed = provided.trim();
  if (!trimmed) return false;

  const configured = getConfiguredFinanceKeys();
  if (configured.length === 0) return false;

  const providedDigest = digestKey(trimmed);
  for (const candidate of configured) {
    const expectedDigest = digestKey(candidate);
    if (
      expectedDigest.length === providedDigest.length &&
      timingSafeEqual(expectedDigest, providedDigest)
    ) {
      return true;
    }
  }
  return false;
}

function extractFinanceApiKey(req: NextRequest): string | null {
  const headerKey = req.headers.get('x-api-key');
  if (headerKey) return headerKey;

  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * Auth + rate-limit gate for /api/finance/*.
 * Returns a NextResponse on failure, or null when the request may proceed.
 */
export async function guardFinanceApi(req: NextRequest): Promise<NextResponse | null> {
  if (getConfiguredFinanceKeys().length === 0) {
    console.error('[finance-auth] FINANCE_API_KEY is not configured');
    return NextResponse.json({ error: 'Finance API unavailable' }, { status: 503 });
  }

  const apiKey = extractFinanceApiKey(req);
  if (validateFinanceApiKey(apiKey)) {
    // Trusted caller (Bitácora). One sync fires ~50 requests in a few seconds and the
    // container is a single instance, so the anonymous 30/min burst limiter must not apply.
    const trusted = await financeTrustedRateLimit(req);
    if (trusted instanceof Response) {
      return trusted as NextResponse;
    }
    return null;
  }

  // Missing or wrong key: keep the strict anonymous-abuse limits, then 401.
  const ip = getClientIP(req);
  const burst = rateLimit(ip, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    identifier: 'finance-burst',
  });
  if (!burst.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: burst.headers },
    );
  }

  const rl = await financeRateLimit(req);
  if (rl instanceof Response) {
    return rl as NextResponse;
  }

  console.warn('[finance-auth] Unauthorized finance API attempt', {
    ip,
    path: req.nextUrl.pathname,
    hasKey: Boolean(apiKey),
  });
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
