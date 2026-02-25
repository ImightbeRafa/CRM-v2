import { NextRequest, NextResponse } from 'next/server';
import { sendMessage } from '@/lib/bot/telegram';
import { prisma } from '@/lib/db';

// GET /api/cron/logistics-report
// Called by Vercel Cron at 05:00 UTC = 11:00 PM CST (UTC-6)
// Secured with CRON_SECRET bearer token
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const chatId = process.env.LOGISTICS_TELEGRAM_CHAT_ID;
    if (!chatId) {
        console.warn('[logistics-report] LOGISTICS_TELEGRAM_CHAT_ID not set');
        return NextResponse.json({ error: 'LOGISTICS_TELEGRAM_CHAT_ID not configured' }, { status: 500 });
    }

    try {
        // Today's date range (CST = UTC-6, so "today" starts at 06:00 UTC)
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setUTCHours(6, 0, 0, 0); // 00:00 CST
        if (now.getUTCHours() < 6) todayStart.setUTCDate(todayStart.getUTCDate() - 1);

        const todayEnd = new Date(todayStart);
        todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

        const todayStr = todayStart.toISOString().slice(0, 10);

        // Fetch today's orders
        const orders = await prisma.$queryRaw<any[]>`
            SELECT
                o.id, o."tenantId",
                lm.carrier, lm.is_contra_entrega, lm.contraentrega_collected, lm.status
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            WHERE o.timestamp >= ${todayStart} AND o.timestamp < ${todayEnd}
        `;

        const total = orders.length;
        const mensajeria = orders.filter(o => o.carrier === 'mensajeria').length;
        const correos = orders.filter(o => o.carrier === 'correos').length;
        const unassigned = orders.filter(o => !o.carrier).length;
        const ceTotal = orders.filter(o => o.is_contra_entrega).length;
        const cePending = orders.filter(o => o.is_contra_entrega && !o.contraentrega_collected).length;
        const ceCollected = ceTotal - cePending;

        // Outstanding CE balance from lm_gd_balance_entries
        const balanceRes = await prisma.$queryRaw<{ balance: number }[]>`
            SELECT COALESCE(SUM(CASE WHEN entry_type='charge' THEN amount ELSE -amount END), 0) AS balance
            FROM lm_gd_balance_entries
        `;
        const gdBalance = Number(balanceRes[0]?.balance ?? 0);

        const fmt = (n: number) => `₡${Math.round(n).toLocaleString('es-CR')}`;
        const dateLabel = new Date(todayStart).toLocaleDateString('es-CR', { weekday: 'long', day: '2-digit', month: 'long' });

        const message = [
            `📦 <b>Reporte Logístico Diario</b>`,
            `📅 <b>${dateLabel}</b>`,
            ``,
            `<b>── Paquetes de Hoy ──</b>`,
            `📊 Total: <b>${total}</b>`,
            `🚚 Mensajería: <b>${mensajeria}</b>`,
            `📮 Correos CR: <b>${correos}</b>`,
            unassigned > 0 ? `⚠️ Sin asignar: <b>${unassigned}</b>` : `✅ Todos asignados`,
            ``,
            `<b>── Contra Entregas ──</b>`,
            `💵 Total CE hoy: <b>${ceTotal}</b>`,
            `✅ Cobradas: <b>${ceCollected}</b>`,
            cePending > 0 ? `🔴 Pendientes: <b>${cePending}</b>` : `🟢 Sin pendientes`,
            ``,
            `<b>── Saldo Green Delivery ──</b>`,
            gdBalance > 0
                ? `🔴 Saldo por cobrar: <b>${fmt(gdBalance)}</b>`
                : `🟢 Cuenta al día`,
            ``,
            `🤖 <i>Generado automáticamente a las 11:00 PM CST</i>`,
        ].filter(Boolean).join('\n');

        await sendMessage(chatId, message, { parseMode: 'HTML' });

        return NextResponse.json({
            success: true,
            date: todayStr,
            stats: { total, mensajeria, correos, unassigned, ceTotal, cePending, ceCollected, gdBalance },
        });
    } catch (error) {
        console.error('[logistics-report]', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
