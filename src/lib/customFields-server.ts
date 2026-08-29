import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import type { CustomFieldsData } from '@/lib/customFields';

/**
 * Server-only: loads tenant custom-field config via Prisma.
 * Do not import this module from Client Components.
 */
export async function getTenantCustomFields(tenantId: string): Promise<CustomFieldsData> {
  return withTenantContext(
    { tenantId, userId: 'system', userName: 'system', userRole: 'system' },
    async () => {
      const tenantPrisma = getTenantPrisma(tenantId);

      const productFields = await tenantPrisma.productField.findMany({
        where: { active: true },
        orderBy: [{ order: 'asc' }, { key: 'asc' }],
        include: {
          optionSet: {
            include: {
              options: {
                where: { active: true },
                orderBy: { label: 'asc' }
              }
            }
          }
        },
      });

      const businessInfoFields = await tenantPrisma.businessInfo.findMany({
        where: { isActive: true, tenantId },
        orderBy: { order: 'asc' },
      });

      return {
        productFields: productFields.map((field: {
          id: string;
          key: string;
          label: string;
          type: string;
          required: boolean;
          order: number;
          optionSetId: string | null;
          multiSelect: boolean;
          active: boolean;
          optionSet?: { options?: Array<{ id: string; label: string; value: string; priceDelta?: number }> };
        }) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          order: field.order,
          optionSetId: field.optionSetId,
          multiSelect: field.multiSelect,
          active: field.active,
          options: field.optionSet?.options || []
        })),
        businessInfoFields
      };
    }
  );
}
