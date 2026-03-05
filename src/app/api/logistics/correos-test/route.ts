import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';
import { isProxyConfigured, getProxyUrl } from '@/lib/correos/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/logistics/correos-test
 *
 * Diagnostic endpoint — validates Correos connectivity.
 * Tests: Proxy config -> Proxy health -> Token auth -> SOAP province lookup.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const results: { step: string; ok: boolean; ms: number; detail?: string }[] = [];

    try {
        const proxyConfigured = isProxyConfigured();
        const proxyUrl = getProxyUrl();
        results.push({
            step: 'proxy_configured',
            ok: proxyConfigured,
            ms: 0,
            detail: proxyConfigured
                ? `CORREOS_PROXY_URL = ${proxyUrl}`
                : 'CORREOS_PROXY_URL or CORREOS_PROXY_SECRET not set — using direct connection',
        });
        console.log(`[correos-test] Proxy: ${proxyConfigured ? `CONFIGURED (${proxyUrl})` : 'NOT CONFIGURED (direct)'}`);

        if (proxyConfigured) {
            console.log('[correos-test] Step 2: Proxy health check...');
            const t0 = Date.now();
            try {
                const healthRes = await fetch(`${proxyUrl}/health`, {
                    signal: AbortSignal.timeout(10_000),
                });
                const elapsed = Date.now() - t0;
                if (healthRes.ok) {
                    const body = await healthRes.text();
                    console.log(`[correos-test] Proxy health: OK (${elapsed}ms)`);
                    results.push({ step: 'proxy_health', ok: true, ms: elapsed, detail: `Proxy is alive — ${body}` });
                } else {
                    console.error(`[correos-test] Proxy health: BAD STATUS ${healthRes.status} (${elapsed}ms)`);
                    results.push({ step: 'proxy_health', ok: false, ms: elapsed, detail: `Proxy returned ${healthRes.status}` });
                    return NextResponse.json({ ok: false, results, diagnosis: 'Proxy is not responding correctly.' });
                }
            } catch (e: any) {
                const elapsed = Date.now() - t0;
                console.error(`[correos-test] Proxy health: FAILED (${elapsed}ms): ${e.message}`);
                results.push({ step: 'proxy_health', ok: false, ms: elapsed, detail: e.message });
                return NextResponse.json({ ok: false, results, diagnosis: 'Cannot reach proxy server.' });
            }
        }

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

        console.log('[correos-test] Step: requesting token...');
        const tToken = Date.now();
        try {
            await ws.getSoapClient().getTokenManager().getToken();
            const elapsed = Date.now() - tToken;
            console.log(`[correos-test] Token: OK (${elapsed}ms)`);
            results.push({ step: 'token', ok: true, ms: elapsed });
        } catch (e: any) {
            const elapsed = Date.now() - tToken;
            console.error(`[correos-test] Token: FAILED (${elapsed}ms): ${e.message}`);
            results.push({ step: 'token', ok: false, ms: elapsed, detail: e.message });
        }

        console.log('[correos-test] Step: calling SOAP ccrCodProvincia...');
        const tSoap = Date.now();
        try {
            const prov = await ws.getSoapClient().getProvincias();
            const count = prov.Provincias?.length ?? 0;
            const elapsed = Date.now() - tSoap;
            console.log(`[correos-test] Provinces: OK (${elapsed}ms, ${count} items)`);
            results.push({ step: 'soap_provincias', ok: prov.CodRespuesta === '00', ms: elapsed, detail: `${count} provinces` });
        } catch (e: any) {
            const elapsed = Date.now() - tSoap;
            console.error(`[correos-test] Provinces: FAILED (${elapsed}ms): ${e.message}`);
            results.push({ step: 'soap_provincias', ok: false, ms: elapsed, detail: e.message });
        }

        const allOk = results.every((r) => r.ok);
        return NextResponse.json({ ok: allOk, results });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: 'Unexpected error', results }, { status: 500 });
    }
}
