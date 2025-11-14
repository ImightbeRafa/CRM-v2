import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/tenantContext';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

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
        existingClient = await prisma.client.findFirst({
          where: { 
            phone, 
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
            province,
            canton,
            district,
            address: address || existingClient.address,
            business: business || existingClient.business,
            username: username || existingClient.username,
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
            province,
            canton,
            district,
            address: address || '',
            business: business || '',
            username: username || '',
            totalOrders: 0,
            totalSpent: 0,
            averageOrderValue: 0,
            firstOrder: new Date(),
            lastOrder: new Date(),
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

