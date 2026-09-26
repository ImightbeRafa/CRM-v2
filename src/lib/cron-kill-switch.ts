/**
 * Copy-host kill switch. Set DISABLE_CRONS=1 or true on any process that
 * shares the live database so /api/cron/* cannot run beside Vercel crons.
 */
export function cronsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DISABLE_CRONS;
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true';
}
