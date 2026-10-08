/**
 * POST /api/chat/agents/[id]/test/unlock — RETIRED (F1, 2026-10-08).
 * Channels are activated with "Probar y activar" (/api/chat/agents/[id]/activation): the agent's own tests, then
 * one click. The old replay/canary approval wrote records that no longer unlock anything and could overwrite an
 * Activar record, so this route only answers 410.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  return NextResponse.json(
    { success: false, code: 'RETIRED', error: 'Usá "Probar y activar" en Probar para activar el agente en el canal.' },
    { status: 410 },
  )
}
