/**
 * Default Order Statuses
 * These statuses are automatically created for every new tenant
 * They match the expectations of the Kanban board component
 */

import { prisma } from './db';

export const DEFAULT_ORDER_STATUSES = [
  { key: 'pendiente', label: 'Pendiente', color: '#FCD34D', order: 0 },
  { key: 'en-proceso', label: 'En Proceso', color: '#60A5FA', order: 1 },
  { key: 'urgente', label: 'Urgente', color: '#EF4444', order: 2 },
  { key: 'completado', label: 'Completado', color: '#10B981', order: 3 },
  { key: 'enviado', label: 'Enviado', color: '#A855F7', order: 4 },
  { key: 'entregado', label: 'Entregado', color: '#059669', order: 5 },
];

/**
 * Create default order statuses for a tenant
 * @param tenantId - The tenant ID to create statuses for
 * @param tenantName - The tenant name (for logging)
 */
export async function createDefaultOrderStatuses(tenantId: string, tenantName?: string) {
  try {
    // Import tenant context here to avoid circular dependencies
    const { withTenantContext } = await import('./tenantContext');
    
    // First, check if statuses already exist for this tenant
    const existingStatuses = await prisma.orderStatus.count({
      where: { tenantId }
    });

    // Only create if no statuses exist yet
    if (existingStatuses === 0) {
      // Create statuses without tenant isolation since we're setting up the tenant
      // Use raw Prisma client to bypass tenant context middleware
      const { withoutTenantIsolation } = await import('./tenantContext');
      
      try {
        await withoutTenantIsolation(async () => {
          await prisma.orderStatus.createMany({
            data: DEFAULT_ORDER_STATUSES.map(status => ({
              ...status,
              tenantId,
              isActive: true,
            })),
            skipDuplicates: true
          });
        });
        
        console.log(`✅ Created ${DEFAULT_ORDER_STATUSES.length} default order statuses for tenant: ${tenantName || tenantId}`);
        return true;
      } catch (error) {
        console.error(`⚠️ Error creating statuses with raw client:`, error);
        // Fallback: try with regular prisma in case withoutTenantIsolation doesn't work
        try {
          await prisma.orderStatus.createMany({
            data: DEFAULT_ORDER_STATUSES.map(status => ({
              ...status,
              tenantId,
              isActive: true,
            })),
            skipDuplicates: true
          });
          console.log(`✅ Created ${DEFAULT_ORDER_STATUSES.length} default order statuses (fallback) for tenant: ${tenantName || tenantId}`);
          return true;
        } catch (fallbackError) {
          console.error(`❌ Fallback also failed:`, fallbackError);
          throw fallbackError;
        }
      }
    }
    
    console.log(`ℹ️ Using existing order statuses for tenant: ${tenantName || tenantId}`);
    return true;
  } catch (error) {
    console.error(`⚠️ Failed to create default order statuses for tenant ${tenantName || tenantId}:`, error);
    // Don't throw - we don't want to fail user registration if status creation fails
    return false;
  }
}

