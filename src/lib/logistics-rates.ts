import { prisma } from '@/lib/db';

export const LOGISTICS_RATE_DEFAULTS = {
    mensajeria_rate: 2500,
    correos_rate: 2500,
    handling_rate: 600,
    salary_daily_rate: 10000,
    gd_recoleccion_cost: 2500,
} as const;

export type LogisticsRateKey = keyof typeof LOGISTICS_RATE_DEFAULTS;

export const LOGISTICS_RATE_KEYS = Object.keys(LOGISTICS_RATE_DEFAULTS) as LogisticsRateKey[];

export async function getLogisticsRates(keys: LogisticsRateKey[] = LOGISTICS_RATE_KEYS) {
    const rates: Record<LogisticsRateKey, number> = { ...LOGISTICS_RATE_DEFAULTS };
    const uniqueKeys = [...new Set(keys)];

    if (uniqueKeys.length === 0) return rates;

    const rows = await prisma.$queryRawUnsafe<{ key: string; value: string }[]>(
        'SELECT key, value FROM lm_carrier_configs WHERE key = ANY($1::text[])',
        uniqueKeys,
    );

    for (const row of rows) {
        if (LOGISTICS_RATE_KEYS.includes(row.key as LogisticsRateKey)) {
            const value = Number(row.value);
            rates[row.key as LogisticsRateKey] = Number.isFinite(value) && value >= 0
                ? value
                : LOGISTICS_RATE_DEFAULTS[row.key as LogisticsRateKey];
        }
    }

    return rates;
}
