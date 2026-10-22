import { NextResponse } from 'next/server';
import { handleContactIntake } from '@/lib/support/contact-intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Legacy public contact endpoint, kept for old callers with its response shape.
 * Same intake as /api/support/contact (rate limit, spam checks, ticket or the legacy email
 * when SUPPORT_PIPELINE_ENABLED is off), see src/lib/support/contact-intake.ts.
 */
export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || !raw.name || !raw.email || !raw.subject || !raw.message) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }
  if (typeof raw.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
  }
  const result = await handleContactIntake(request, raw);
  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    case 'rate_limited':
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    case 'turnstile':
      return NextResponse.json({ error: result.error }, { status: 400 });
    case 'failed':
      return NextResponse.json({ error: 'Failed to send email. Please try again later.' }, { status: 500 });
    case 'accepted':
      return NextResponse.json({
        success: true,
        message: 'Message sent successfully! We\'ll get back to you soon.',
        ...(result.ticketRef ? { ticketNumber: result.ticketRef } : {}),
      });
  }
}
