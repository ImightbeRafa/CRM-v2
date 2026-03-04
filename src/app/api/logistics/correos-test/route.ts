import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import tls from 'tls';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Attempt a raw TCP connection to host:port with a timeout.
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
 * Attempt a TLS handshake to host:port and report negotiated protocol/cipher.
 */
function tlsProbe(host: string, port: number, timeoutMs = 15_000): Promise<{ ok: boolean; ms: number; protocol?: string; cipher?: string; error?: string }> {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const socket = tls.connect(
            { host, port, servername: host, timeout: timeoutMs, rejectUnauthorized: true },
            () => {
                const proto = socket.getProtocol();
                const cipher = socket.getCipher()?.name;
                socket.destroy();
                resolve({ ok: true, ms: Date.now() - t0, protocol: proto ?? undefined, cipher });
            }
        );

        socket.on('timeout', () => {
            socket.destroy();
            resolve({ ok: false, ms: Date.now() - t0, error: 'TLS handshake timeout' });
        });
        socket.on('error', (err: any) => {
            socket.destroy();
            resolve({ ok: false, ms: Date.now() - t0, error: err.code || err.message });
        });
    });
}

/**
 * GET /api/logistics/correos-test
 *
 * Diagnostic endpoint — validates Correos production connectivity.
 * Phase 1: TCP reachability to production endpoints.
 * Phase 2: TLS handshake probes (both token and SOAP use HTTPS).
 * Phase 3: Token auth + SOAP province lookup.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const results: { step: string; ok: boolean; ms: number; detail?: string }[] = [];

    try {
        // Phase 0: Proxy configuration check
        const proxyConfigured = !!process.env.FIXIE_URL;
        results.push({
            step: 'proxy_configured',
            ok: proxyConfigured,
            ms: 0,
            detail: proxyConfigured ? 'FIXIE_URL is set' : 'FIXIE_URL not set — direct connections will be used',
        });
        console.log(`[correos-test] Proxy: ${proxyConfigured ? 'CONFIGURED (Fixie)' : 'NOT CONFIGURED (direct)'}`);

        // When proxy is configured, traffic goes through Fixie so direct
        // TCP/TLS probes are irrelevant. Skip to API calls.
        let tokenReachable = proxyConfigured;
        let soapReachable = proxyConfigured;

        if (!proxyConfigured) {
            // Phase 1: TCP connectivity probes (only without proxy)
            const probes = [
                { label: 'tcp_token_447',   host: 'servicios.correos.go.cr',  port: 447 },
                { label: 'tcp_soap_444',    host: 'amistadpro.correos.go.cr', port: 444 },
                { label: 'tcp_control_443', host: 'google.com',               port: 443 },
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

            tokenReachable = probeResults.find((r) => r.step === 'tcp_token_447')?.ok ?? false;
            soapReachable = probeResults.find((r) => r.step === 'tcp_soap_444')?.ok ?? false;

            if (!tokenReachable && !soapReachable) {
                console.warn('[correos-test] Both Correos production ports blocked and no proxy configured');
                return NextResponse.json({
                    ok: false,
                    results,
                    diagnosis: 'Correos production ports (447, 444) are unreachable. Configure FIXIE_URL proxy.',
                });
            }

            // Phase 2: TLS handshake probes
            const tlsTargets = [
                { label: 'tls_token_447', host: 'servicios.correos.go.cr', port: 447, portOpen: tokenReachable },
                { label: 'tls_soap_444', host: 'amistadpro.correos.go.cr', port: 444, portOpen: soapReachable },
            ];

            for (const t of tlsTargets) {
                if (!t.portOpen) continue;
                console.log(`[correos-test] Phase 2: TLS probe to ${t.host}:${t.port}...`);
                const tlsResult = await tlsProbe(t.host, t.port);
                console.log(
                    `[correos-test] ${t.label}: ${tlsResult.ok ? 'OK' : 'FAILED'} (${tlsResult.ms}ms` +
                    `${tlsResult.protocol ? ', ' + tlsResult.protocol : ''}` +
                    `${tlsResult.cipher ? ', ' + tlsResult.cipher : ''}` +
                    `${tlsResult.error ? ', ' + tlsResult.error : ''})`
                );
                results.push({
                    step: t.label,
                    ok: tlsResult.ok,
                    ms: tlsResult.ms,
                    detail: tlsResult.ok
                        ? `${tlsResult.protocol}, ${tlsResult.cipher}`
                        : tlsResult.error,
                });
            }
        }

        // Phase 3: Actual API calls (via proxy when configured, direct otherwise)
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
        if (tokenReachable) {
            console.log('[correos-test] Step: requesting token (native https)...');
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
            results.push({ step: 'token', ok: false, ms: 0, detail: 'skipped — port 447 unreachable' });
        }

        // Step: SOAP provinces
        if (soapReachable) {
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
            results.push({ step: 'soap_provincias', ok: false, ms: 0, detail: 'skipped — port 444 unreachable' });
        }

        const allOk = results.every((r) => r.ok);
        return NextResponse.json({ ok: allOk, results });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: 'Unexpected error', results }, { status: 500 });
    }
}
