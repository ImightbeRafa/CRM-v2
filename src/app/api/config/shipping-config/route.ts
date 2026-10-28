import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { encrypt } from '@/lib/encryption';
import { withTenantContext } from '@/lib/tenantContext';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { hasPermission } from '@/lib/rbac';

const WS_CREDENTIAL_KEYS = [
  'ws_username', 'ws_password', 'ws_sistema',
  'ws_usuario_id', 'ws_servicio_id', 'ws_cod_cliente',
];

const CORREOS_V3_SETTING_KEYS = [
  'correos_api', 'ws_sender_province', 'ws_sender_canton', 'ws_sender_district', 'ws_default_weight_g',
  'correos_pickup_cedula', 'correos_pickup_email',
] as const;

/** Pickup cédula (personal data, Ley 8968) only in full for people who can edit the config (SecureDog DATA-76). */
function maskPickupCedula(settings: any, canEdit: boolean): any {
  if (canEdit || !settings || typeof settings !== 'object' || !settings.correos_pickup_cedula) return settings;
  const digits = String(settings.correos_pickup_cedula).replace(/\D/g, '');
  return { ...settings, correos_pickup_cedula: `•••${digits.slice(-3)}` };
}

function stripWSCredentials(settings: any): any {
  if (!settings || typeof settings !== 'object') return settings ?? null;
  const cleaned = { ...settings };
  for (const key of WS_CREDENTIAL_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    const { tenantId, userId, role } = auth;
    const userName = 'Authenticated user';

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
        safe.settings = maskPickupCedula(safe.settings, hasPermission(role, 'update_config'));
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
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    const { tenantId, userId, role } = auth;
    const userName = 'Authenticated user';

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
          settings: stripWSCredentials(settings),
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
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    const { tenantId, userId, role } = auth;
    const userName = 'Authenticated user';

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

      let mergedSettings = stripWSCredentials(settings);
      // Correos v3 keys are edited in the setup wizard only: a save from another screen that does not send
      // them keeps the stored values instead of silently switching the store back to SOAP (verifier #4).
      if (mergedSettings && typeof mergedSettings === 'object') {
        const current = await prisma.shippingConfig.findFirst({ where: { id, tenantId }, select: { settings: true } });
        const prev = (current?.settings && typeof current.settings === 'object' ? current.settings : {}) as Record<string, unknown>;
        for (const key of CORREOS_V3_SETTING_KEYS) {
          if (!(key in mergedSettings) && key in prev) mergedSettings = { ...mergedSettings, [key]: prev[key] };
        }
        // A masked cédula coming back from GET never overwrites the stored one.
        if (typeof mergedSettings.correos_pickup_cedula === 'string' && mergedSettings.correos_pickup_cedula.startsWith('•')) {
          mergedSettings = { ...mergedSettings, correos_pickup_cedula: prev.correos_pickup_cedula ?? '' };
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
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    const { tenantId, userId, role } = auth;
    const userName = 'Authenticated user';

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
