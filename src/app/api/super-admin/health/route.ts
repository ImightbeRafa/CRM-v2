import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { getBackupStatus } from '@/lib/backups/service'
import { listErrorGroups } from '@/lib/observability/error-groups'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

/** Platform health for Betsy admins: backup state + recent error groups. Others get 404. */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  if (!(await isSuperAdmin(auth.userId))) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  const raw = request.nextUrl.searchParams.get('status')
  const status = raw === 'muted' || raw === 'resolved' || raw === 'all' ? raw : 'open'
  const rawSource = request.nextUrl.searchParams.get('source')
  const source = rawSource === 'client' || rawSource === 'all' ? rawSource : 'server'
  try {
    const [backup, errors] = await Promise.all([getBackupStatus(), listErrorGroups({ status, source, limit: 100 })])
    return NextResponse.json(
      {
        backup: {
          status: backup.status,
          fullHoursAgo: backup.full ? Math.round(backup.full.hoursAgo) : null,
          hotHoursAgo: backup.hot ? Math.round(backup.hot.hoursAgo) : null,
          recommendations: backup.recommendations,
        },
        errors,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('[super-admin/health] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Failed' }, { status: 500, headers: NO_STORE })
  }
}
