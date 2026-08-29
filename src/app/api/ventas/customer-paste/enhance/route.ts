import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { readTenantUiReadiness } from '@/lib/feature-flags';
import { createIdentifierRateLimit } from '@/lib/rate-limit';
import { enhanceCustomerPasteWithGrok } from '@/lib/customer-paste-grok';

export const maxDuration = 15;

const limiter = createIdentifierRateLimit({
  windowMs: 60 * 60 * 1000,
  maxRequests: 20,
  identifier: 'ventas-customer-paste-ai',
});

const candidate = z.object({
  name: z.string().max(160), phone: z.string().max(40), email: z.string().max(254),
  username: z.string().max(160), province: z.string().max(80), canton: z.string().max(100),
  district: z.string().max(120), address: z.string().max(600),
});
const requestSchema = z.object({ rawText: z.string().trim().min(3).max(6_000), heuristic: candidate });

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'create_sales');
  if (!auth.ok) return auth.response;
  const readiness = await readTenantUiReadiness(auth.tenantId);
  return NextResponse.json({ enabled: readiness.aiCustomerPaste && Boolean(process.env.XAI_API_KEY) });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'create_sales');
  if (!auth.ok) return auth.response;
  const readiness = await readTenantUiReadiness(auth.tenantId);
  if (!readiness.aiCustomerPaste) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!process.env.XAI_API_KEY) return NextResponse.json({ error: 'AI enhancement is not configured' }, { status: 503 });

  const limited = await limiter(`${auth.tenantId}:${auth.userId}`);
  if (!limited.allowed) {
    return NextResponse.json({ error: 'AI enhancement rate limit reached' }, { status: 429, headers: limited.headers });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid customer text' }, { status: 400 });

  try {
    const suggestion = await enhanceCustomerPasteWithGrok({
      tenantId: auth.tenantId,
      userId: auth.userId,
      rawText: parsed.data.rawText,
      heuristic: parsed.data.heuristic,
    });
    const sourceHash = createHash('sha256').update(parsed.data.rawText).digest('hex');
    return NextResponse.json({ suggestion, sourceHash }, { headers: limited.headers });
  } catch (error) {
    console.error('[CustomerPasteAI] Enhancement failed', {
      tenantId: auth.tenantId,
      code: error instanceof Error ? error.name : 'unknown_error',
    });
    return NextResponse.json({ error: 'AI enhancement failed; heuristic values were kept' }, { status: 502 });
  }
}
