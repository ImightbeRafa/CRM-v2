/**
 * Who may see a support ticket (SPEC §9). Pure.
 * Tenant and role always come from the verified session, never from the request.
 */

export type SupportViewer = { userId: string; tenantId: string | null; role: string | null }
export type SupportTicketOwnership = { userId: string | null; tenantId: string | null }

export const TENANT_TICKET_ROLES = new Set(['OWNER', 'ADMIN'])

export function canViewerSeeTicket(viewer: SupportViewer, ticket: SupportTicketOwnership): boolean {
  if (!viewer.userId) return false
  // A business ticket is only reachable from inside that business (a removed member loses it).
  if (ticket.tenantId && ticket.tenantId !== viewer.tenantId) return false
  if (ticket.userId && ticket.userId === viewer.userId) return true
  return Boolean(
    viewer.tenantId &&
      ticket.tenantId &&
      ticket.tenantId === viewer.tenantId &&
      viewer.role &&
      TENANT_TICKET_ROLES.has(viewer.role),
  )
}

/** Prisma `where` matching exactly the tickets `canViewerSeeTicket` allows. */
export function viewerTicketWhere(viewer: SupportViewer): Record<string, unknown> {
  // Own tickets of THIS business, or own tickets without a business.
  const or: Record<string, unknown>[] = [{ userId: viewer.userId, OR: [{ tenantId: viewer.tenantId }, { tenantId: null }] }]
  if (viewer.tenantId && viewer.role && TENANT_TICKET_ROLES.has(viewer.role)) {
    or.push({ tenantId: viewer.tenantId })
  }
  // Spam rows stay out of customer views.
  return { OR: or, NOT: { status: 'spam' } }
}
