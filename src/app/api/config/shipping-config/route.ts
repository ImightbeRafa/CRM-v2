import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { getToken } from 'next-auth/jwt';
import { encrypt, decrypt } from '@/lib/encryption';
import { withTenantContext } from '@/lib/tenantContext';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission (OWNER, ADMIN, or MANAGER)
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden - Requires OWNER, ADMIN, or MANAGER role' }, { status: 403 });
    }

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const userName = (token as any).name || (token as any).email || 'System';
    
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      
      const configs = await prisma.shippingConfig.findMany({
        where: { isActive: true, tenantId },
        orderBy: { name: 'asc' }
      });

      const safeConfigs = configs.map(config => {
        const safe: any = { ...config, password: config.password ? '***' : null };
        if (safe.settings && typeof safe.settings === 'object' && safe.settings.ws_password) {
          safe.settings = { ...safe.settings, ws_password: '***' };
        }
        return safe;
      });

      return NextResponse.json({
        status: 'success',
        data: safeConfigs
      });
    });
  } catch (error) {
    console.error('Error loading shipping configs:', error);
    return NextResponse.json(
      { error: 'Failed to load shipping configurations' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission (OWNER, ADMIN, or MANAGER)
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;
    console.log('🔐 [Shipping Config POST] User role:', role, 'Token:', { currentTenant: (token as any).currentTenant, membershipRole: (token as any).membershipRole });
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'MANAGER') {
      console.error('❌ [Shipping Config POST] Access denied. Role:', role);
      return NextResponse.json({ error: `Forbidden - Requires OWNER, ADMIN, or MANAGER role. Your role: ${role}` }, { status: 403 });
    }

    const body = await request.json();
    const {
      carrier,
      name,
      email,
      password,
      apiKey,
      baseUrl,
      isDefault,
      settings
    } = body;

    // Validate required fields
    if (!carrier || !name) {
      return NextResponse.json(
        { error: 'Carrier and name are required' },
        { status: 400 }
      );
    }

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const userName = (token as any).name || (token as any).email || 'System';
    
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      
      // If this is set as default, unset other defaults in same tenant
      if (isDefault) {
        await prisma.shippingConfig.updateMany({
          where: { isDefault: true, tenantId },
          data: { isDefault: false }
        });
      }

      const passwordToStore = (password && password !== '***') ? encrypt(password) : null;
      const apiKeyToStore = apiKey ? encrypt(apiKey) : null;

      const shippingConfig = await prisma.shippingConfig.create({
        data: {
          carrier,
          name,
          email,
          password: passwordToStore,
          apiKey: apiKeyToStore,
          baseUrl,
          isDefault,
          settings: settings || null,
          tenantId
        }
      });

      return NextResponse.json({
        status: 'success',
        data: {
          ...shippingConfig,
          password: shippingConfig.password ? '***' : null
        }
      });
    });
  } catch (error) {
    console.error('Error creating shipping config:', error);
    return NextResponse.json(
      { error: 'Failed to create shipping configuration' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission (OWNER, ADMIN, or MANAGER)
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden - Requires OWNER, ADMIN, or MANAGER role' }, { status: 403 });
    }

    const body = await request.json();
    const {
      id,
      carrier,
      name,
      email,
      password,
      apiKey,
      baseUrl,
      isDefault,
      settings
    } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      );
    }

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const userName = (token as any).name || (token as any).email || 'System';
    
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);

      // If this is set as default, unset other defaults in same tenant
      if (isDefault) {
        await prisma.shippingConfig.updateMany({
          where: { 
            isDefault: true,
            id: { not: id }
          },
          data: { 
            isDefault: false
          }
        });
      }

      const passwordToStore = (password && password !== '***') ? encrypt(password) : undefined;
      const apiKeyToStore = apiKey ? encrypt(apiKey) : apiKey;

      let mergedSettings = settings || null;
      if (mergedSettings && typeof mergedSettings === 'object') {
        if (!mergedSettings.ws_password || mergedSettings.ws_password === '***') {
          const existing = await prisma.shippingConfig.findUnique({ where: { id }, select: { settings: true } });
          const existingSettings = (existing?.settings as Record<string, any>) ?? {};
          if (existingSettings.ws_password) {
            mergedSettings = { ...mergedSettings, ws_password: existingSettings.ws_password };
          } else {
            delete mergedSettings.ws_password;
          }
        }
      }

      const updateData: any = {
        carrier,
        name,
        email,
        apiKey: apiKeyToStore,
        baseUrl,
        isDefault,
        settings: mergedSettings,
        updatedAt: new Date()
      };

      if (passwordToStore !== undefined) {
        updateData.password = passwordToStore;
      }

      const shippingConfig = await prisma.shippingConfig.update({
        where: { id },
        data: updateData
      });

      return NextResponse.json({
        status: 'success',
        data: {
          ...shippingConfig,
          password: shippingConfig.password ? '***' : null
        }
      });
    });
  } catch (error) {
    console.error('Error updating shipping config:', error);
    return NextResponse.json(
      { error: 'Failed to update shipping configuration' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission (OWNER, ADMIN, or MANAGER)
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden - Requires OWNER, ADMIN, or MANAGER role' }, { status: 403 });
    }

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const userName = (token as any).name || (token as any).email || 'System';
    
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      );
    }

    return await withTenantContext({ tenantId, userId, role, userRole: role, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      
      // Verify ownership before deleting
      const config = await prisma.shippingConfig.findFirst({
        where: { id, tenantId }
      });

      if (!config) {
        return NextResponse.json({ error: 'Config not found' }, { status: 404 });
      }

      // Soft delete by setting isActive to false
      await prisma.shippingConfig.update({
        where: { id },
        data: { isActive: false }
      });

      return NextResponse.json({
        status: 'success',
        message: 'Shipping configuration deleted successfully'
      });
    });
  } catch (error) {
    console.error('Error deleting shipping config:', error);
    return NextResponse.json(
      { error: 'Failed to delete shipping configuration' },
      { status: 500 }
    );
  }
}
