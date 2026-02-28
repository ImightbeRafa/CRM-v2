import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/correos-test
 *
 * Diagnostic endpoint that validates Correos connectivity from the server.
 * Tests: token auth → SOAP connection → province lookup.
 * Protected by logistics admin guard.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const results: { step: string; ok: boolean; ms: number; detail?: string }[] = [];

    try {
        const credRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs WHERE key LIKE 'correos_ws_%'
        `;
        const cfg: Record<string, string> = {};
        for (const row of credRows) cfg[row.key] = row.value;

        if (!cfg.correos_ws_username || !cfg.correos_ws_password) {
            return NextResponse.json({
                ok: false,
                error: 'Correos WS credentials not configured',
                results,
            });
        }

        const wsCreds: CorreosWSCredentials = {
            username: cfg.correos_ws_username,
            password: cfg.correos_ws_password,
            sistema: cfg.correos_ws_sistema || 'PYMEXPRESS',
            usuarioId: Number(cfg.correos_ws_usuario_id) || 0,
            servicioId: Number(cfg.correos_ws_servicio_id) || 0,
            codCliente: cfg.correos_ws_cod_cliente || '',
        };

        const ws = new CorreosWebService(wsCreds);

        // Step 1: Token
        let t = Date.now();
        try {
            await ws.getSoapClient().getTokenManager().getToken();
            results.push({ step: 'token', ok: true, ms: Date.now() - t });
        } catch (e: any) {
            results.push({ step: 'token', ok: false, ms: Date.now() - t, detail: e.message });
        }

        // Step 2: SOAP — list provinces (lightest call)
        t = Date.now();
        try {
            const prov = await ws.getSoapClient().getProvincias();
            const count = prov.Provincias?.length ?? 0;
            results.push({ step: 'soap_provincias', ok: prov.CodRespuesta === '00', ms: Date.now() - t, detail: `${count} provinces` });
        } catch (e: any) {
            results.push({ step: 'soap_provincias', ok: false, ms: Date.now() - t, detail: e.message });
        }

        const allOk = results.every((r) => r.ok);
        return NextResponse.json({ ok: allOk, results });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: 'Unexpected error', results }, { status: 500 });
    }
}
