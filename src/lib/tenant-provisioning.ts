import type { Prisma } from '@prisma/client';
import { DEFAULT_ORDER_STATUSES } from './default-statuses';
import { buildOwnedTenantSlug } from './membership-lifecycle';

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

export type ProvisionOwnedTenantInput = {
  userId: string;
  email: string;
  displayName: string;
  businessName?: string | null;
  phone?: string | null;
  country?: string | null;
  province?: string | null;
};

export async function provisionOwnedTenantForExistingUser(
  tx: Prisma.TransactionClient,
  input: ProvisionOwnedTenantInput,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;

  const existingActive = await tx.membership.findFirst({
    where: { userId: input.userId, isActive: true },
    include: { tenant: true },
    orderBy: { joinedAt: 'desc' },
  });
  if (existingActive?.tenant) {
    return existingActive.tenant;
  }

  const tenant = await tx.tenant.create({
    data: {
      name: input.businessName || `${input.displayName}'s Organization`,
      slug: buildOwnedTenantSlug(input.email),
      plan: 'FREE',
      isActive: true,
      trialEndsAt: new Date(Date.now() + TRIAL_MS),
      businessName: input.businessName || null,
      ownerName: input.displayName,
      phone: input.phone || null,
      country: input.country || null,
      province: input.province || null,
      profileCompleted: !!(input.phone && input.country),
    },
  });

  await tx.membership.create({
    data: {
      userId: input.userId,
      tenantId: tenant.id,
      role: 'OWNER',
      isActive: true,
      joinedAt: new Date(),
    },
  });

  await tx.orderStatus.createMany({
    data: DEFAULT_ORDER_STATUSES.map((status) => ({
      ...status,
      tenantId: tenant.id,
      isActive: true,
    })),
    skipDuplicates: true,
  });

  await tx.user.update({
    where: { id: input.userId },
    data: { defaultTenantId: tenant.id },
  });

  return tenant;
}
