import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Attempt a raw TCP connection to host:port with a timeout.
 * Returns { reachable, ms, error? }.
 */
function tcpProbe(host: string, port: number, timeoutMs = 10_000): Promise<{ reachable: boolean; ms: number; error?: string }> {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            socket.destroy();
            resolve({ reachable: true, ms: Date.now() - t0 });
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve({ reachable: false, ms: Date.now() - t0, error: 'timeout' });
        });
        socket.on('error', (err: any) => {
            socket.destroy();
            resolve({ reachable: false, ms: Date.now() - t0, error: err.code || err.message });
        });

        socket.connect(port, host);
    });
}

/**
 * GET /api/logistics/correos-test
 *
 * Diagnostic endpoint that validates Correos connectivity from the server.
 * Phase 1: Raw TCP port reachability (standard + non-standard).
 * Phase 2: Token auth + SOAP call (only if ports are reachable).
 * Protected by logistics admin guard.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const results: { step: string; ok: boolean; ms: number; detail?: string }[] = [];

    try {
        // Phase 1: Raw TCP connectivity probes (run all in parallel)
        const probes = [
            { label: 'tcp_token_442',  host: 'servicios.correos.go.cr', port: 442 },
            { label: 'tcp_token_443',  host: 'servicios.correos.go.cr', port: 443 },
            { label: 'tcp_soap_84',    host: 'amistad.correos.go.cr',   port: 84 },
            { label: 'tcp_soap_80',    host: 'amistad.correos.go.cr',   port: 80 },
            { label: 'tcp_control_443', host: 'google.com',             port: 443 },
        ];

        console.log('[correos-test] Phase 1: TCP port reachability probes...');
        const probeResults = await Promise.all(
            probes.map(async (p) => {
                const r = await tcpProbe(p.host, p.port);
                console.log(`[correos-test] ${p.label} (${p.host}:${p.port}): ${r.reachable ? 'OPEN' : 'BLOCKED'} (${r.ms}ms${r.error ? ', ' + r.error : ''})`);
                return { step: p.label, ok: r.reachable, ms: r.ms, detail: r.reachable ? `${p.host}:${p.port} open` : `${p.host}:${p.port} ${r.error}` };
            })
        );
        results.push(...probeResults);

        const tokenPortOpen = probeResults.find((r) => r.step === 'tcp_token_442')?.ok;
        const soapPortOpen = probeResults.find((r) => r.step === 'tcp_soap_84')?.ok;

        // Phase 2: Actual API calls (skip if ports are blocked)
        if (!tokenPortOpen && !soapPortOpen) {
            console.warn('[correos-test] Both Correos ports blocked — skipping API tests');
            return NextResponse.json({
                ok: false,
                results,
                diagnosis: 'Correos uses non-standard ports (442, 84) which are unreachable from this server. A proxy or different hosting environment is needed.',
            });
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

        // Step: Token
        if (tokenPortOpen) {
            console.log('[correos-test] Step: requesting token...');
            const t = Date.now();
            try {
                await ws.getSoapClient().getTokenManager().getToken();
                const elapsed = Date.now() - t;
                console.log(`[correos-test] Step: token OK (${elapsed}ms)`);
                results.push({ step: 'token', ok: true, ms: elapsed });
            } catch (e: any) {
                const elapsed = Date.now() - t;
                console.error(`[correos-test] Step: token FAILED (${elapsed}ms): ${e.message}`);
                results.push({ step: 'token', ok: false, ms: elapsed, detail: e.message });
            }
        } else {
            results.push({ step: 'token', ok: false, ms: 0, detail: 'skipped — port 442 unreachable' });
        }

        // Step: SOAP provinces
        if (soapPortOpen) {
            console.log('[correos-test] Step: calling SOAP ccrCodProvincia...');
            const t = Date.now();
            try {
                const prov = await ws.getSoapClient().getProvincias();
                const count = prov.Provincias?.length ?? 0;
                const elapsed = Date.now() - t;
                console.log(`[correos-test] Step: provinces OK (${elapsed}ms, ${count} items)`);
                results.push({ step: 'soap_provincias', ok: prov.CodRespuesta === '00', ms: elapsed, detail: `${count} provinces` });
            } catch (e: any) {
                const elapsed = Date.now() - t;
                console.error(`[correos-test] Step: provinces FAILED (${elapsed}ms): ${e.message}`);
                results.push({ step: 'soap_provincias', ok: false, ms: elapsed, detail: e.message });
            }
        } else {
            results.push({ step: 'soap_provincias', ok: false, ms: 0, detail: 'skipped — port 84 unreachable' });
        }

        const allOk = results.every((r) => r.ok);
        return NextResponse.json({ ok: allOk, results });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: 'Unexpected error', results }, { status: 500 });
    }
}
