import { NextResponse } from 'next/server'
import { handleContactIntake } from '@/lib/support/contact-intake'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Public contact form (/soporte). Never echoes internals; spam gets the same 200. */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null)
  const result = await handleContactIntake(request, raw)
  switch (result.kind) {
    case 'invalid':
      return NextResponse.json({ ok: false, error: result.error, fields: result.fields }, { status: 400 })
    case 'rate_limited':
      return NextResponse.json({ ok: false, error: 'Demasiados mensajes. Probá de nuevo en un rato.' }, { status: 429 })
    case 'turnstile':
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    case 'failed':
      return NextResponse.json({ ok: false, error: 'No pudimos enviar tu mensaje. Intentá de nuevo.' }, { status: 500 })
    case 'accepted':
      return NextResponse.json({ ok: true, ticketNumber: result.ticketRef })
  }
}
