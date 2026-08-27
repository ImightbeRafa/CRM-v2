import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/integration-auth';
import { withTenantContext } from '@/lib/tenantContext';
import { logIntegrationActivity } from '@/lib/integration-logs';
import { guardTenantWrite } from '@/lib/billing-access';
import { generateGuiasForOrders } from '@/lib/bot/guia-service';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const DELIVERY_TYPES = ['Domicilio', 'Sucursal', 'Punto de correo'] as const;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let tenantId: string | null = null;
  try {
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
    tenantId = await validateApiKey(apiKey);
    if (!tenantId) {
      await logIntegrationActivity(null, 'INVALID_API_KEY', { provided: true });
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const guard = await guardTenantWrite(tenantId, { channel: 'integration-api', route: '/api/integration/guia/generate' });
    if (!guard.allowed) return guard.response;

    const body = await request.json();
    const { orderIds, carrier = 'correos_cr', deliveryType = 'Domicilio' } = body;
    if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.some(id => typeof id !== 'string')) {
      return NextResponse.json({ error: 'orderIds array is required' }, { status: 400 });
    }
    if (!DELIVERY_TYPES.includes(deliveryType)) {
      return NextResponse.json({ error: 'Invalid deliveryType' }, { status: 400 });
    }

    return withTenantContext({ tenantId, userId: 'system', role: 'SYSTEM', userRole: 'SYSTEM', userName: 'API' }, async () => {
      const batch = await generateGuiasForOrders(tenantId!, orderIds, carrier, {
        deliveryType,
        adapter: 'tenant-guia',
        concurrency: 3,
        timeoutMs: 20_000,
      });
      const processingTime = Date.now() - startedAt;
      await logIntegrationActivity(tenantId, 'GUIA_GENERATED', {
        requested: orderIds.length,
        successful: batch.successful,
        failed: batch.failed,
        processingTime,
      });
      return NextResponse.json({
        success: true,
        data: {
          results: batch.results.map(result => ({
            success: result.success,
            orderId: result.orderId,
            guiaNumber: result.guiaNumber,
            trackingNumber: result.trackingNumber,
            error: result.error,
            pdfDownloaded: Boolean(result.pdfBuffer),
          })),
          successful: batch.successful,
          failed: batch.failed,
        },
        processingTime,
      });
    });
  } catch (error) {
    const processingTime = Date.now() - startedAt;
    console.error('[Guia API] Generation failed', { type: error instanceof Error ? error.name : 'unknown', processingTime });
    await logIntegrationActivity(tenantId, 'GUIA_GENERATION_ERROR', {
      errorType: error instanceof Error ? error.name : 'unknown',
      processingTime,
    }).catch(() => undefined);
    return NextResponse.json({ error: 'Failed to generate guías', processingTime }, { status: 500 });
  }
}
