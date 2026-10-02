import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { setErrorGroupStatus } from '@/lib/observability/error-groups'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

/** Mark an error group open / muted / resolved (Betsy admins only). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  if (!(await isSuperAdmin(auth.userId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { id } = await context.params
  if (!/^[a-z]+:[0-9a-f]{16}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  const status = body?.status
  if (status !== 'open' && status !== 'muted' && status !== 'resolved') {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
  }
  const ok = await setErrorGroupStatus(id, status)
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
