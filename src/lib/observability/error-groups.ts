import 'server-only'
import { prisma } from '@/lib/db'

export type ErrorGroupDto = {
  id: string
  source: string
  route: string | null
  name: string
  message: string
  stack: string | null
  count: number
  firstSeen: string
  lastSeen: string
  status: string
}

function missingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'P2021' || code === '42P01' || /42P01|does not exist/.test(error instanceof Error ? error.message : '')
}

/** Most recent error groups (platform admin view). Empty before SQL 040. */
export async function listErrorGroups(opts: { status?: 'open' | 'muted' | 'resolved' | 'all'; limit?: number } = {}): Promise<{ groups: ErrorGroupDto[]; tableReady: boolean }> {
  try {
    const rows = await prisma.opsErrorGroup.findMany({
      where: opts.status && opts.status !== 'all' ? { status: opts.status } : undefined,
      orderBy: { lastSeen: 'desc' },
      take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    })
    return {
      tableReady: true,
      groups: rows.map((r) => ({
        id: r.id,
        source: r.source,
        route: r.route,
        name: r.name,
        message: r.message,
        stack: r.stack,
        count: r.count,
        firstSeen: r.firstSeen.toISOString(),
        lastSeen: r.lastSeen.toISOString(),
        status: r.status,
      })),
    }
  } catch (error) {
    if (missingTable(error)) return { groups: [], tableReady: false }
    throw error
  }
}

export async function setErrorGroupStatus(id: string, status: 'open' | 'muted' | 'resolved'): Promise<boolean> {
  try {
    const res = await prisma.opsErrorGroup.updateMany({ where: { id }, data: { status } })
    return res.count > 0
  } catch (error) {
    if (missingTable(error)) return false
    throw error
  }
}
