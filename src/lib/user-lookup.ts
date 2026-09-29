/**
 * Exact, case-insensitive user lookup by email (security, 2026-09-29).
 *
 * Prisma's `equals` + `mode: 'insensitive'` compiles to ILIKE on Postgres without escaping `%` / `_`,
 * so an "email" like `%@corp.com` matched the first user of that domain (SecureDog L3): password
 * spraying without knowing addresses. `lower(email) = lower($1)` is an exact comparison.
 */
import 'server-only'
import { prisma } from '@/lib/db'

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const value = email.trim()
  if (!value) return null
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "User" WHERE lower(email) = lower(${value}) ORDER BY "createdAt" ASC LIMIT 1`
  return rows[0]?.id ?? null
}
