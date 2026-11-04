/** Shared by deepsleep-no-weight-apply.ts and -revert.ts: backup shape, tenant guard, actor lookup. */
import { prisma } from '@/lib/db'
import type { SalesRules } from '@/lib/soft-ai/agent-sales-setup'

export type NoWeightChange =
  | { kind: 'instructions'; agentId: string; before: string; after: string }
  | { kind: 'shortcut'; agentId: string; shortcutId: string; key: string; before: string; after: string }
  | {
      kind: 'knowledge'
      agentId: string
      name: string
      sourceKind: string
      beforeSourceId: string
      beforeBody: string
      priority: number
      after: string
      /** Set by --apply once the new version exists. */
      afterSourceId: string | null
    }
  | { kind: 'brand_facts'; agentId: string; before: Record<string, unknown>; after: Record<string, unknown> }
  /** Only the edited selling-rule keys (before = live values, after = new values). */
  | { kind: 'sales_rules'; agentId: string; before: Partial<SalesRules>; after: Partial<SalesRules> }

export type NoWeightBackupV1 = {
  version: 1
  kind: 'deepsleep-no-weight'
  createdAt: string
  tenantId: string
  changes: NoWeightChange[]
}

/** Key-order independent JSON equality (jsonb does not keep key order). */
export function sameJson(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export async function requireNoWeightTenant(confirm: string | null, tenantId: string, slug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true } })
  if (!tenant || tenant.slug !== slug) throw new Error(`Refusing: tenant ${tenantId} slug is ${tenant?.slug}, expected ${slug}`)
  if (!confirm) throw new Error(`Refusing: pass --confirm-tenant=${slug}`)
  if (confirm !== tenant.slug) throw new Error(`Refusing: --confirm-tenant=${confirm} does not match live slug ${tenant.slug}`)
  return tenant
}

export async function resolveNoWeightActor(emailRaw: string, tenantId: string, label: string) {
  const email = emailRaw.trim().toLowerCase()
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, email: true },
  })
  if (!user?.email || user.email.toLowerCase() !== email) throw new Error(`No user with exact email ${email}`)
  const member = await prisma.membership.findFirst({
    where: { userId: user.id, tenantId, isActive: true, role: { in: ['OWNER', 'ADMIN'] } },
    select: { role: true },
  })
  if (!member) throw new Error(`User ${email} has no active OWNER/ADMIN membership on this tenant`)
  return { actorUserId: user.id, actorName: `${user.name || user.email} (${label})`, actorRole: String(member.role) }
}
