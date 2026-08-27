import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { shouldUseOrderLifecycleV2 } from '@/lib/feature-flags';
import { setLifecycleOrderStatus } from '@/lib/order-lifecycle';

export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_production');
  if (!auth.ok) return auth.response;
  const { tenantId, userId } = auth;
  const body = await request.json();
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0 || entries.length > 100) {
    return NextResponse.json({ error: 'One to 100 manual guías are required' }, { status: 400 });
  }
  const clean: Array<{ orderId: string; guiaNumber: string }> = entries.map((entry: any) => ({
    orderId: String(entry.orderId || '').trim(),
    guiaNumber: String(entry.guiaNumber || '').trim(),
  }));
  if (clean.some(entry => !entry.orderId || !entry.guiaNumber)) {
    return NextResponse.json({ error: 'Each order and guía number is required' }, { status: 400 });
  }

  const tenantPrisma = getTenantPrisma(tenantId);
  const orders = await tenantPrisma.order.findMany({ where: { orderId: { in: clean.map(entry => entry.orderId) } } });
  if (orders.length !== clean.length) return NextResponse.json({ error: 'Some orders were not found' }, { status: 404 });

  for (const entry of clean) {
    const duplicate = await tenantPrisma.shippingGuia.findFirst({
      where: { guiaNumber: entry.guiaNumber, orderId: { not: entry.orderId } },
      select: { id: true },
    });
    if (duplicate) return NextResponse.json({ error: `Guía ${entry.guiaNumber} is already assigned` }, { status: 409 });
  }

  const saved = [];
  const lifecycleV2 = await shouldUseOrderLifecycleV2(tenantId, 'tenant-guia');
  for (const entry of clean) {
    const existing = await tenantPrisma.shippingGuia.findFirst({ where: { orderId: entry.orderId, carrier: 'manual' } });
    const guia = existing
      ? await tenantPrisma.shippingGuia.update({
          where: { id: existing.id },
          data: { guiaNumber: entry.guiaNumber, trackingNumber: entry.guiaNumber, status: 'completed', serviceType: 'manual', errorMessage: null },
        })
      : await tenantPrisma.shippingGuia.create({
          data: {
            orderId: entry.orderId,
            carrier: 'manual',
            guiaNumber: entry.guiaNumber,
            trackingNumber: entry.guiaNumber,
            status: 'completed',
            serviceType: 'manual',
            tenant: { connect: { id: tenantId } },
          },
        });
    const order = orders.find(item => item.orderId === entry.orderId)!;
    if (lifecycleV2) {
      await setLifecycleOrderStatus({
        tenantId,
        userId,
        adapter: 'tenant-guia',
        idempotencyKey: `manual-guia:${order.id}:${entry.guiaNumber}`,
        orderId: order.orderId,
        status: 'Enviado',
        courier: 'manual',
      });
    } else {
      await tenantPrisma.order.update({ where: { id: order.id }, data: { status: 'Enviado', courier: 'manual' } });
    }
    saved.push({ id: guia.id, orderId: guia.orderId, guiaNumber: guia.guiaNumber });
  }
  return NextResponse.json({ status: 'success', data: saved });
}
