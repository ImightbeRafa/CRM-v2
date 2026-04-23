import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const dynamic = 'force-dynamic';

const MANAGED_IDS = [
    'cmh32z0ol0000k004hvx9tg3p', 'cmhsibjue0004js04gie724nx', 'cmhutd1th0000jp04oqibtz54',
    'cmigornmw0000lb04kl75262e', 'cmjdabz4d0000il04dyc5qmcc', 'cmln5u7k70000ld042qify2og',
    'cmh44aerw0006vijg0640vfl0', 'cmm4pv8fl0000jr045en1nik9',
];

async function getBrowser() {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        const chromium = await import('@sparticuz/chromium');
        const puppeteer = await import('puppeteer-core');
        return puppeteer.default.launch({
            args: chromium.default.args,
            defaultViewport: { width: 1200, height: 800 },
            executablePath: await chromium.default.executablePath(),
            headless: true,
        });
    } else {
        const puppeteer = await import('puppeteer');
        return puppeteer.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    }
}

const fmt = (n: number) => `₡${(n || 0).toLocaleString('es-CR')}`;
function escapeHtml(value: unknown): string {
    return String(value ?? '—')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const CORREOS_TAX_RATE = 0.13;
function getCorreosTax(cost: unknown): number {
    if (cost == null) return 0;
    const amount = Number(cost);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.round(amount * CORREOS_TAX_RATE);
}
const fmtDate = (d: string) => {
    try { return new Date(d + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return d; }
};

function getWorkUnits(notes: unknown): number {
    if (typeof notes !== 'string' || !notes.trim()) return 1;
    try {
        const parsed = JSON.parse(notes);
        const units = Number(parsed?.units);
        if (units === 0.5 || units === 1) return units;
        return parsed?.dayType === 'half' ? 0.5 : 1;
    } catch {
        return 1;
    }
}

/**
 * GET /api/logistics/reports/pdf?weekId=<id>
 * Generates a PDF report for the specified billing week.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const weekId = url.searchParams.get('weekId');

    if (!weekId) {
        return NextResponse.json({ error: 'weekId required' }, { status: 400 });
    }

    let browser = null;

    try {
        const weekRows = await prisma.$queryRawUnsafe<{
            id: number; week_start: string; week_end: string;
            finalized_at: string | null; finalized_by: string | null;
        }[]>(
            `SELECT id, week_start::text, week_end::text, finalized_at::text, finalized_by
             FROM lm_billing_weeks WHERE id = $1`,
            Number(weekId)
        );

        if (weekRows.length === 0) {
            return NextResponse.json({ error: 'Billing week not found' }, { status: 404 });
        }

        const week = weekRows[0];
        const ws = week.week_start.slice(0, 10);
        const we = week.week_end.slice(0, 10);

        const rateRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key IN ('mensajeria_rate','correos_rate','handling_rate','salary_daily_rate','gd_recoleccion_cost')
        `;
        const cfg: Record<string, number> = {};
        for (const r of rateRows) cfg[r.key] = Number(r.value) || 0;
        const handlingRate = cfg['handling_rate'] ?? 600;
        const salaryRate = cfg['salary_daily_rate'] ?? 10000;
        const gdRecoleccionCost = cfg['gd_recoleccion_cost'] ?? 2700;

        const tenantRows = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(`
            SELECT id, name FROM "Tenant" WHERE id = ANY($1::text[])
        `, MANAGED_IDS);
        const tenantNameMap: Record<string, string> = {};
        for (const t of tenantRows) tenantNameMap[t.id] = t.name;

        const orders = await prisma.$queryRawUnsafe<any[]>(`
            SELECT DISTINCT ON (o.id)
                o.id, o."orderId", o."customerName", o.total, o.timestamp,
                o.province, o.product, o."tenantId",
                lm.carrier, lm.status AS lm_status,
                lm.is_contra_entrega, lm.correos_shipping_cost,
                sg."guiaNumber"
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            LEFT JOIN LATERAL (
                SELECT sg."guiaNumber"
                FROM "ShippingGuia" sg
                WHERE sg."tenantId" = o."tenantId"
                  AND sg."orderId" = o."orderId"
                  AND sg.carrier = 'correos_cr'
                ORDER BY sg."updatedAt" DESC, sg."createdAt" DESC
                LIMIT 1
            ) sg ON TRUE
            WHERE lm.billed_week_id = $1
            ORDER BY o.id, o.timestamp ASC
        `, Number(weekId));

        orders.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const workDays = (await prisma.$queryRawUnsafe<any[]>(
            `SELECT work_date, notes FROM lm_work_days
             WHERE staff_name IN ('Ma', 'JKY')
               AND work_date >= $1::date AND work_date <= $2::date
             ORDER BY work_date`,
            ws, we
        )).map((day) => ({ ...day, work_units: getWorkUnits(day.notes) }));

        interface TenantBlock {
            tenantId: string; tenantName: string;
            correosOrders: any[]; mensajeriaOrders: any[];
            correosShipping: number; correosHandling: number;
            correosTax: number;
            mensajeriaRecoleccion: number; mensajeriaHandling: number;
            subtotal: number;
        }

        const tenantBlocks: TenantBlock[] = [];
        let grandTotalPackages = 0;
        let grandTotalShipping = 0;
        let grandTotalHandling = 0;
        let grandTotalTax = 0;
        let grandSubtotalLogistics = 0;

        for (const tenantId of MANAGED_IDS) {
            const tOrders = orders.filter(o => o.tenantId === tenantId);
            if (tOrders.length === 0) continue;

            const cOrders = tOrders.filter(o => o.carrier === 'correos');
            const mOrders = tOrders.filter(o => o.carrier === 'mensajeria');
            const cShip = cOrders.reduce((s: number, o: any) => s + (o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : 0), 0);
            const cTax = cOrders.reduce((s: number, o: any) => s + getCorreosTax(o.correos_shipping_cost), 0);
            const cHandl = cOrders.length * handlingRate;
            const mRecol = mOrders.length > 0 ? gdRecoleccionCost : 0;
            const mHandl = mOrders.length * handlingRate;
            const sub = cShip + cTax + cHandl + mRecol + mHandl;

            grandTotalPackages += tOrders.length;
            grandTotalShipping += cShip + mRecol;
            grandTotalHandling += cHandl + mHandl;
            grandTotalTax += cTax;
            grandSubtotalLogistics += sub;

            tenantBlocks.push({
                tenantId, tenantName: tenantNameMap[tenantId] || tenantId,
                correosOrders: cOrders, mensajeriaOrders: mOrders,
                correosShipping: cShip, correosTax: cTax, correosHandling: cHandl,
                mensajeriaRecoleccion: mRecol, mensajeriaHandling: mHandl,
                subtotal: sub,
            });
        }

        const salaryDays = workDays.reduce((sum, day) => sum + Number(day.work_units ?? 1), 0);
        const salaryTotal = salaryDays * salaryRate;
        const grandTotal = grandSubtotalLogistics + salaryTotal;

        const html = buildReportHTML({
            weekStart: ws, weekEnd: we,
            finalizedAt: week.finalized_at,
            tenantBlocks,
            grandTotalPackages, grandTotalShipping, grandTotalTax, grandTotalHandling,
            grandSubtotalLogistics,
            salaryDays, salaryRate, salaryTotal, grandTotal,
            handlingRate,
        });

        browser = await getBrowser();
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
        });
        await browser.close();
        browser = null;

        return new NextResponse(Buffer.from(pdfBuffer), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="reporte-logistica-${ws}_${we}.pdf"`,
                'Content-Length': pdfBuffer.length.toString(),
            },
        });
    } catch (error) {
        console.error('[reports/pdf GET]', error);
        return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
    } finally {
        if (browser) { try { await browser.close(); } catch {} }
    }
}

function buildReportHTML(data: {
    weekStart: string; weekEnd: string; finalizedAt: string | null;
    tenantBlocks: any[];
    grandTotalPackages: number; grandTotalShipping: number; grandTotalTax: number; grandTotalHandling: number;
    grandSubtotalLogistics: number;
    salaryDays: number; salaryRate: number; salaryTotal: number; grandTotal: number;
    handlingRate: number;
}): string {
    const tenantSections = data.tenantBlocks.map(t => {
        const allOrders = [...t.correosOrders, ...t.mensajeriaOrders]
            .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const orderRows = allOrders.map((o: any) => `
            <tr>
                <td>${escapeHtml(o.orderId)}</td>
                <td>${escapeHtml(o.customerName)}</td>
                <td>${o.carrier === 'correos' ? 'Correos' : 'GD'}</td>
                <td>${escapeHtml(o.province)}</td>
                <td style="text-align:right">${fmt(Number(o.total))}</td>
                <td style="text-align:right">${o.carrier === 'correos' && o.correos_shipping_cost != null ? fmt(Number(o.correos_shipping_cost)) : '—'}</td>
                <td style="text-align:right">${o.carrier === 'correos' && o.correos_shipping_cost != null ? fmt(getCorreosTax(o.correos_shipping_cost)) : '—'}</td>
                <td style="text-align:right">${fmt(data.handlingRate)}</td>
                <td>${escapeHtml(o.guiaNumber)}</td>
            </tr>
        `).join('');

        return `
            <div class="tenant-block">
                <h3>${escapeHtml(t.tenantName)}</h3>
                <div class="summary-row">
                    <span>Paquetes: <strong>${t.correosOrders.length + t.mensajeriaOrders.length}</strong></span>
                    <span>Correos: <strong>${t.correosOrders.length}</strong> (envío: ${fmt(t.correosShipping)}, impuestos: ${fmt(t.correosTax)}, manejo: ${fmt(t.correosHandling)})</span>
                    <span>GD: <strong>${t.mensajeriaOrders.length}</strong> (recol: ${fmt(t.mensajeriaRecoleccion)}, manejo: ${fmt(t.mensajeriaHandling)})</span>
                    <span>Subtotal: <strong>${fmt(t.subtotal)}</strong></span>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Orden</th><th>Cliente</th><th>Carrier</th><th>Provincia</th>
                            <th style="text-align:right">Total</th>
                            <th style="text-align:right">Envío</th>
                            <th style="text-align:right">Impuestos</th>
                            <th style="text-align:right">Manejo</th>
                            <th>Guía</th>
                        </tr>
                    </thead>
                    <tbody>${orderRows}</tbody>
                </table>
            </div>
        `;
    }).join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reporte Logística — ${data.weekStart} a ${data.weekEnd}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 30px; color: #1a1a2e; font-size: 11px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    h2 { font-size: 14px; color: #555; margin-top: 24px; }
    h3 { font-size: 13px; margin: 16px 0 6px; border-bottom: 2px solid #8b87ff; padding-bottom: 4px; color: #333; }
    .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #1a1a2e; padding-bottom: 12px; }
    .sub { color: #666; font-size: 12px; }
    .tenant-block { margin-bottom: 20px; page-break-inside: avoid; }
    .summary-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; font-size: 10.5px; color: #555; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10.5px; }
    th, td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
    .grand-total { margin-top: 20px; padding: 16px; border: 2px solid #1a1a2e; border-radius: 8px; page-break-inside: avoid; }
    .grand-total h2 { margin-top: 0; color: #1a1a2e; }
    .gt-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 12px; }
    .gt-item { text-align: center; }
    .gt-item .label { color: #666; font-size: 10px; text-transform: uppercase; }
    .gt-item .value { font-size: 16px; font-weight: bold; margin-top: 4px; }
    .gt-final { text-align: right; font-size: 20px; font-weight: bold; border-top: 2px solid #1a1a2e; padding-top: 10px; margin-top: 10px; }
    .footer { margin-top: 30px; text-align: center; color: #999; font-size: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Reporte de Logística Semanal</h1>
    <div class="sub">${fmtDate(data.weekStart)} — ${fmtDate(data.weekEnd)}</div>
    ${data.finalizedAt ? `<div class="sub">Finalizado: ${new Date(data.finalizedAt).toLocaleDateString('es-CR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
  </div>

  ${tenantSections}

  <div class="grand-total">
    <h2>Resumen General</h2>
    <div class="gt-grid">
      <div class="gt-item"><div class="label">Paquetes</div><div class="value">${data.grandTotalPackages}</div></div>
      <div class="gt-item"><div class="label">Envíos</div><div class="value">${fmt(data.grandTotalShipping)}</div></div>
      <div class="gt-item"><div class="label">Impuestos</div><div class="value">${fmt(data.grandTotalTax)}</div></div>
      <div class="gt-item"><div class="label">Manejo</div><div class="value">${fmt(data.grandTotalHandling)}</div></div>
      <div class="gt-item"><div class="label">Subtotal Logística</div><div class="value">${fmt(data.grandSubtotalLogistics)}</div></div>
    </div>
    <div class="gt-grid">
      <div class="gt-item"><div class="label">Días Trabajados</div><div class="value">${data.salaryDays}</div></div>
      <div class="gt-item"><div class="label">Tarifa Diaria</div><div class="value">${fmt(data.salaryRate)}</div></div>
      <div class="gt-item"><div class="label">Salario</div><div class="value">${fmt(data.salaryTotal)}</div></div>
      <div class="gt-item"></div>
    </div>
    <div class="gt-final">GRAN TOTAL: ${fmt(data.grandTotal)}</div>
  </div>

  <div class="footer">Generado por Betsy CRM — Logistics Manager</div>
</body>
</html>
    `;
}
