import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { isTenantFeatureNotDisabled } from '@/lib/feature-flags'
import { CHAT_OUTBOUND_MEDIA_FLAG } from '@/lib/chat-outbound-media'

export const dynamic = 'force-dynamic'

/** GET /api/chat/capabilities — per-business chat switches the inbox UI needs. */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const outboundMedia = await isTenantFeatureNotDisabled(auth.tenantId, CHAT_OUTBOUND_MEDIA_FLAG)
  return NextResponse.json({ success: true, outboundMedia }, { headers: { 'Cache-Control': 'no-store' } })
}
