import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/tenantContext';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { normalizeClientEmail, normalizeClientPhone } from '@/lib/order-lifecycle';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Require 'update_sales' permission and get tenant/user context
    const auth = await authenticateAPIWithPermission(request, 'update_sales');
    if (!auth.ok) return auth.response as NextResponse;
    const { tenantId, userId, userRole } = auth as any;

    const body = await request.json();
    const {
      customerId, // If provided, update this specific customer
      name,
      phone,
      email,
      province,
      canton,
      district,
      address,
      business,
      username
    } = body;

    // Validate required fields
    if (!phone || !name || typeof phone !== 'string' || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 });
    }

    const userName = (auth as any)?.session?.user?.name || (auth as any)?.session?.user?.email || 'System';
    
    return await withTenantContext({ tenantId, userId: userId || 'system', role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);

      // Stats for this one customer, grouped by phone like the manual full sync does.
      const orderStats = async () => {
        const agg = await prisma.order.aggregate({
          // Lifecycle orders store the phone trimmed; the form sends it as typed.
          where: { tenantId, phone: { in: Array.from(new Set([phone, phone.trim()])) } },
          _count: { _all: true },
          _sum: { total: true },
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        const totalOrders = agg._count._all;
        const totalSpent = Number(agg._sum.total || 0);
        return {
          totalOrders,
          totalSpent,
          averageOrderValue: totalOrders > 0 ? totalSpent / totalOrders : 0,
          ...(agg._min.timestamp ? { firstOrder: agg._min.timestamp } : {}),
          ...(agg._max.timestamp ? { lastOrder: agg._max.timestamp } : {}),
        };
      };
      // The order was just saved, so 0 means the phone did not match: keep the stored stats.
      const computed = await orderStats();
      const stats = computed.totalOrders > 0 ? computed : {};

      let existingClient = null as any;

      // If a specific customer ID was provided, use that
      if (customerId) {
        existingClient = await prisma.client.findFirst({
          where: { 
            id: customerId, 
            isActive: true
          }
        });
      }

      // Otherwise, check if client exists with this phone number
      if (!existingClient) {
        const normalizedPhone = normalizeClientPhone(phone);
        existingClient = await prisma.client.findFirst({
          where: { 
            OR: [{ normalizedPhone }, { phone }],
            isActive: true
          }
        });
      }

      if (existingClient) {
        // UPDATE existing client with new information
        console.log('[update-from-order] Updating existing client:', {
          clientId: existingClient.id,
          name: existingClient.name,
          phone: existingClient.phone,
          tenantId
        });
        
        const updatedClient = await prisma.client.update({
          where: { id: existingClient.id },
          data: {
            name,
            email: email || existingClient.email,
            normalizedPhone: normalizeClientPhone(phone),
            normalizedEmail: normalizeClientEmail(email || existingClient.email),
            province,
            canton,
            district,
            address: address || existingClient.address,
            business: business || existingClient.business,
            username: username || existingClient.username,
            ...stats,
            lastUpdated: new Date()
          }
        });

        console.log('[update-from-order] ✅ Client updated successfully:', updatedClient.id);
        
        return NextResponse.json({
          status: 'success',
          action: 'updated',
          data: updatedClient
        });
      } else {
        // CREATE new client with explicit tenantId
        console.log('[update-from-order] Creating new client:', {
          name,
          phone,
          tenantId
        });
        
        const newClient = await prisma.client.create({
          data: {
            tenantId,
            name,
            phone,
            email: email || '',
            normalizedPhone: normalizeClientPhone(phone),
            normalizedEmail: normalizeClientEmail(email),
            province,
            canton,
            district,
            address: address || '',
            business: business || '',
            username: username || '',
            firstOrder: new Date(),
            lastOrder: new Date(),
            ...stats,
            isActive: true,
            isFavorite: false,
            createdBy: (userId as string) || 'system'
          }
        });

        console.log('[update-from-order] ✅ New client created:', newClient.id);
        
        return NextResponse.json({
          status: 'success',
          action: 'created',
          data: newClient
        });
      }
    })
  } catch (error) {
    console.error('Error updating client from order:', error);
    const details = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const payload = process.env.NODE_ENV === 'production'
      ? { error: 'Failed to update client' }
      : { error: 'Failed to update client', details, stack };
    return NextResponse.json(payload, { status: 500 });
  }
}

