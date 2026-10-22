import { NextResponse } from 'next/server'
import { getSupportContactConfig } from '@/lib/support/contact-config'
import { supportPipelineEnabled } from '@/lib/support/config'
import { turnstileSiteKey } from '@/lib/turnstile'

export const dynamic = 'force-dynamic'

/** Public business contact info for /soporte (env; nothing secret). */
export async function GET() {
  return NextResponse.json(
    { ...getSupportContactConfig(), tickets: supportPipelineEnabled(), turnstileSiteKey: turnstileSiteKey() },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  )
}
