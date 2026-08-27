import { NextRequest } from 'next/server';
import { MemberRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { createErrorResponse, createSuccessResponse, handleApiError } from '@/lib/apiUtils';
import { resolveDefaultTenantAfterRemoval } from '@/lib/membership-lifecycle';

type RouteContext = { params: Promise<{ id: string }> };

// Legacy compatibility endpoint. Changes are intentionally membership-scoped:
// a tenant administrator must never modify or delete a global user shared by
// another tenant.
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'manage_users');
  if (!auth.ok) return auth.response;

  try {
    const { id: userId } = await params;
    const { role, active } = await request.json();

    if (role !== undefined && !Object.values(MemberRole).includes(role)) {
      return createErrorResponse('Rol inválido', 400);
    }

    const membership = await prisma.membership.findFirst({
      where: { userId, tenantId: auth.tenantId },
      include: { user: { select: { id: true, username: true, email: true } } },
    });
    if (!membership) return createErrorResponse('Usuario no encontrado en este tenant', 404);

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: {
        ...(role !== undefined ? { role } : {}),
        ...(active !== undefined ? { isActive: Boolean(active) } : {}),
      },
    });

    if (active === false) await repairDefaultTenant(userId, auth.tenantId);

    return createSuccessResponse({
      id: membership.user.id,
      username: membership.user.username,
      email: membership.user.email,
      role: updated.role,
      active: updated.isActive,
    }, 'Membresía actualizada exitosamente');
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'manage_users');
  if (!auth.ok) return auth.response;

  try {
    const { id: userId } = await params;
    const membership = await prisma.membership.findFirst({
      where: { userId, tenantId: auth.tenantId },
      include: { user: { select: { isSuperAdmin: true } } },
    });
    if (!membership) return createErrorResponse('Usuario no encontrado en este tenant', 404);
    if (membership.user.isSuperAdmin) return createErrorResponse('No se puede remover al usuario maestro', 400);

    await prisma.membership.update({
      where: { id: membership.id },
      data: { isActive: false },
    });
    await repairDefaultTenant(userId, auth.tenantId);

    return createSuccessResponse(null, 'Usuario removido de este tenant');
  } catch (error) {
    return handleApiError(error);
  }
}

async function repairDefaultTenant(userId: string, removedTenantId: string) {
  const [user, remaining] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { defaultTenantId: true } }),
    prisma.membership.findMany({
      where: { userId, isActive: true },
      select: { tenantId: true },
      orderBy: { joinedAt: 'desc' },
    }),
  ]);
  if (!user) return;

  const nextDefault = resolveDefaultTenantAfterRemoval(
    user.defaultTenantId,
    removedTenantId,
    remaining.map(row => row.tenantId),
  );
  if (nextDefault !== user.defaultTenantId) {
    await prisma.user.update({ where: { id: userId }, data: { defaultTenantId: nextDefault } });
  }
}
