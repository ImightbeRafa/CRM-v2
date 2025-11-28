import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET - Fetch current tenant profile
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (session.user as any).tenantId || (session.user as any).defaultTenantId;
    
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 404 });
    }

    // @ts-ignore - New profile fields exist in schema, regenerate Prisma client if TypeScript complains
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        businessName: true,
        ownerName: true,
        phone: true,
        phoneVerified: true,
        country: true,
        province: true,
        profileCompleted: true,
        plan: true,
        createdAt: true,
      } as any
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      profile: tenant 
    });

  } catch (error: any) {
    console.error('Error fetching tenant profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

// PUT - Update tenant profile
export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (session.user as any).tenantId || (session.user as any).defaultTenantId;
    
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 404 });
    }

    // Check if user has permission to update (OWNER or ADMIN)
    const membership = await prisma.membership.findFirst({
      where: {
        userId: session.user.id,
        tenantId: tenantId,
        isActive: true,
      }
    });

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'No tienes permiso para editar el perfil del negocio' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { businessName, ownerName, phone, country, province } = body;

    // Validate required fields
    if (!phone || phone.trim().length === 0) {
      return NextResponse.json(
        { error: 'El teléfono es requerido' },
        { status: 400 }
      );
    }

    if (!country) {
      return NextResponse.json(
        { error: 'El país es requerido' },
        { status: 400 }
      );
    }

    // Update tenant
    // @ts-ignore - New profile fields exist in schema, regenerate Prisma client if TypeScript complains
    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: businessName || undefined,
        businessName: businessName || undefined,
        ownerName: ownerName || undefined,
        phone: phone,
        country: country,
        province: province || undefined,
        profileCompleted: true, // Mark as completed since required fields are provided
        updatedAt: new Date(),
      } as any,
      select: {
        id: true,
        name: true,
        businessName: true,
        ownerName: true,
        phone: true,
        country: true,
        province: true,
        profileCompleted: true,
      } as any
    });

    console.log(`✅ Tenant profile updated: ${tenantId}`);

    return NextResponse.json({ 
      success: true, 
      message: 'Perfil actualizado correctamente',
      profile: updatedTenant 
    });

  } catch (error: any) {
    console.error('Error updating tenant profile:', error);
    return NextResponse.json(
      { error: 'Error al actualizar el perfil' },
      { status: 500 }
    );
  }
}

