import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const CR_TZ = 'America/Costa_Rica';

function getMondayCR(): string {
    const now = new Date();
    const crStr = now.toLocaleDateString('en-CA', { timeZone: CR_TZ });
    const [y, m, d] = crStr.split('-').map(Number);
    const crDate = new Date(y, m - 1, d);
    const day = crDate.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    crDate.setDate(crDate.getDate() + diff);
    const yy = crDate.getFullYear();
    const mm = String(crDate.getMonth() + 1).padStart(2, '0');
    const dd = String(crDate.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

/**
 * GET /api/cron/logistics-finalize
 *
 * Runs Sunday at 18:00 UTC = 12:00 PM CR (America/Costa_Rica).
 * Finalizes the current open billing week by setting finalized_at.
 * The PDF report can then be generated on-demand via the PDF endpoint.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const monday = getMondayCR();

        const openWeeks = await prisma.$queryRawUnsafe<{
            id: number; week_start: string; week_end: string;
        }[]>(
            `SELECT id, week_start::text, week_end::text
             FROM lm_billing_weeks
             WHERE week_start = $1::date AND finalized_at IS NULL`,
            monday
        );

        if (openWeeks.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No open billing week found for current period',
                weekStart: monday,
            });
        }

        const week = openWeeks[0];

        const countResult = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
            `SELECT COUNT(*)::bigint AS count FROM lm_orders WHERE billed_week_id = $1`,
            week.id
        );
        const orderCount = Number(countResult[0]?.count ?? 0);

        await prisma.$executeRawUnsafe(
            `UPDATE lm_billing_weeks
             SET finalized_at = NOW(), finalized_by = 'system-cron'
             WHERE id = $1 AND finalized_at IS NULL`,
            week.id
        );

        const chatId = process.env.LOGISTICS_TELEGRAM_CHAT_ID;
        if (chatId) {
            try {
                const { sendMessage } = await import('@/lib/bot/telegram');
                const message = [
                    `📊 <b>Periodo Semanal Finalizado</b>`,
                    ``,
                    `📅 Semana: <b>${week.week_start} — ${week.week_end}</b>`,
                    `📦 Órdenes facturadas: <b>${orderCount}</b>`,
                    `✅ Estado: <b>Finalizado automáticamente</b>`,
                    ``,
                    `🤖 <i>El reporte PDF está disponible en Historial</i>`,
                ].join('\n');
                await sendMessage(chatId, message, { parseMode: 'HTML' });
            } catch (tgErr) {
                console.error('[logistics-finalize] Telegram notification failed:', tgErr);
            }
        }

        return NextResponse.json({
            success: true,
            weekId: week.id,
            weekStart: week.week_start,
            weekEnd: week.week_end,
            orderCount,
            finalizedAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[logistics-finalize]', error);
        return NextResponse.json({ error: 'Failed to finalize billing week' }, { status: 500 });
    }
}
