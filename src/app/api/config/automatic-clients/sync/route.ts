import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { normalizeClientEmail, normalizeClientPhone } from '@/lib/order-lifecycle';

export async function POST(request: NextRequest) {
  try {
    // Require 'update_sales' permission
    const auth = await authenticateAPIWithPermission(request, 'update_sales');
    if (!auth.ok) return auth.response;
    
    const { tenantId, userId } = auth;
    console.log('[automatic-clients/sync] Starting sync for tenant:', tenantId);
    const prisma = getTenantPrisma(tenantId);

    // Get all orders to extract unique clients (auto-filtered by tenantPrisma)
    const allOrders = await prisma.order.findMany({
      select: {
        customerName: true,
        phone: true,
        email: true,
        province: true,
        canton: true,
        district: true,
        address: true,
        business: true,
        username: true,
        total: true,
        timestamp: true
      }
    });

    // Filter out orders without customer name or phone
    const orders = allOrders.filter(order => order.customerName && order.phone);

    // Group orders by phone number to get unique clients
    const clientMap = new Map();
    
    orders.forEach(order => {
      const phone = order.phone;
      if (!clientMap.has(phone)) {
        clientMap.set(phone, {
          name: order.customerName,
          phone: order.phone,
          email: order.email,
          province: order.province,
          canton: order.canton,
          district: order.district,
          address: order.address,
          business: order.business,
          username: order.username,
          orders: [],
          totalSpent: 0
        });
      }
      
      const client = clientMap.get(phone);
      client.orders.push({
        total: order.total,
        timestamp: order.timestamp
      });
      client.totalSpent += order.total;
    });

    let syncedCount = 0;
    let updatedCount = 0;

    // Process each unique client
    for (const [phone, clientData] of clientMap) {
      const { orders, totalSpent, ...clientInfo } = clientData;
      
      // Calculate stats
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
      const firstOrder = orders.reduce((earliest: any, order: any) => 
        new Date(order.timestamp) < new Date(earliest.timestamp) ? order : earliest
      );
      const lastOrder = orders.reduce((latest: any, order: any) => 
        new Date(order.timestamp) > new Date(latest.timestamp) ? order : latest
      );

      // Check if client already exists (auto-filtered by tenantPrisma)
      const existingClient = await prisma.client.findFirst({
        where: { OR: [{ normalizedPhone: normalizeClientPhone(phone) }, { phone }], isActive: true }
      });

      if (existingClient) {
        // Update existing client - ONLY update statistics, NOT personal info
        // This prevents overwriting manually edited customer data
        await prisma.client.update({
          where: { id: existingClient.id },
          data: {
            totalOrders,
            totalSpent,
            averageOrderValue,
            firstOrder: firstOrder.timestamp,
            lastOrder: lastOrder.timestamp,
            lastUpdated: new Date()
          }
        });
        updatedCount++;
      } else {
        // Create new client with explicit tenantId
        await prisma.client.create({
          data: {
            tenantId,
            ...clientInfo,
            normalizedPhone: normalizeClientPhone(clientInfo.phone),
            normalizedEmail: normalizeClientEmail(clientInfo.email),
            totalOrders,
            totalSpent,
            averageOrderValue,
            firstOrder: firstOrder.timestamp,
            lastOrder: lastOrder.timestamp,
            isActive: true,
            isFavorite: false,
            createdBy: userId
          }
        });
        syncedCount++;
      }
    }

    console.log('[automatic-clients/sync] ✅ Sync completed:', {
      tenantId,
      syncedClients: syncedCount,
      updatedClients: updatedCount,
      totalClients: clientMap.size
    });
    
    return NextResponse.json({
      status: 'success',
      data: {
        syncedClients: syncedCount,
        updatedClients: updatedCount,
        totalClients: clientMap.size
      },
      message: `Sincronización completada: ${syncedCount} clientes nuevos, ${updatedCount} clientes actualizados`
    });
  } catch (error) {
    console.error('Error syncing automatic clients:', error);
    return NextResponse.json(
      { error: 'Failed to sync automatic clients' },
      { status: 500 }
    );
  }
}
