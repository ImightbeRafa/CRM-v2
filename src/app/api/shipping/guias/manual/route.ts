import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { createRedisLimiter, rateLimitAsync } from '@/lib/rate-limit';

const manualLimiter = createRedisLimiter({ prefix: 'manual-guias', maxRequests: 20, windowMs: 60_000 });
import { shouldUseOrderLifecycleV2 } from '@/lib/feature-flags';
import { setLifecycleOrderStatus } from '@/lib/order-lifecycle';

export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_production');
  if (!auth.ok) return auth.response;
  const { tenantId, userId } = auth;
  const rl = await rateLimitAsync(tenantId, manualLimiter, { maxRequests: 20, windowMs: 60_000, prefix: 'manual-guias' });
  if (!rl.allowed) return NextResponse.json({ error: 'Demasiadas solicitudes, esperá un momento.' }, { status: 429, headers: rl.headers });
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
  // A real Correos number (AA123456789CR) that another business already holds is never accepted (SecureDog DATA-74).
  // Short hand-typed numbers ("1", "123") are per business and not checked across businesses. One query (DB-08).
  const correosNumbers = clean.map(e => e.guiaNumber).filter(n => /^[A-Z]{2}\d{9}CR$/.test(n));
  if (correosNumbers.length) {
    const elsewhere = await globalPrisma.shippingGuia.findFirst({
      where: { tenantId: { not: tenantId }, OR: [{ guiaNumber: { in: correosNumbers } }, { trackingNumber: { in: correosNumbers } }] },
      select: { guiaNumber: true, trackingNumber: true },
    });
    if (elsewhere) {
      const taken = correosNumbers.find(n => n === elsewhere.guiaNumber || n === elsewhere.trackingNumber) || correosNumbers[0];
      return NextResponse.json({ error: `La guía ${taken} no se puede usar.` }, { status: 409 });
    }
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
