import 'server-only';

/**
 * Operations alerts to the platform owner (OPS_ALERT_EMAIL) via Resend. Never throws, never sends
 * customer data: only what failed, when, and a short error code. Same alert at most every 30 min
 * per instance. No-op when OPS_ALERT_EMAIL or RESEND_API_KEY is unset (e.g. Railway preview).
 */
const COOLDOWN_MS = 30 * 60_000;
const SEND_TIMEOUT_MS = 10_000;
const lastSent = new Map<string, number>();

export type OpsAlert = {
  /** Dedupe key, e.g. `backup-failed:full`. */
  key: string;
  subject: string;
  lines: string[];
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function sendOpsAlert(alert: OpsAlert, now = Date.now()): Promise<'sent' | 'skipped' | 'failed'> {
  const to = (process.env.OPS_ALERT_EMAIL || '').trim();
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!to || !apiKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'skipped';
  const prev = lastSent.get(alert.key);
  if (prev && now - prev < COOLDOWN_MS) return 'skipped';
  lastSent.set(alert.key, now);
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const body = alert.lines.map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`).join('');
    // Resend never throws: API / network problems come back as `{ error }` (SecureDog 2026-10-02).
    const send = resend.emails.send({
      from: 'BetsyCRM Alertas <noreply@betsycrm.com>',
      to,
      subject: `[Betsy] ${alert.subject}`.slice(0, 180),
      html: `<div style="font-family:system-ui,sans-serif;font-size:14px">${body}<p style="color:#64748b">${escapeHtml(new Date(now).toISOString())}</p></div>`,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ error: { name: string } }>((resolve) => {
      timer = setTimeout(() => resolve({ error: { name: 'timeout' } }), SEND_TIMEOUT_MS);
    });
    const result = (await Promise.race([send, timeout]).finally(() => timer && clearTimeout(timer))) as {
      error?: { name?: string; statusCode?: number } | null;
    };
    if (result?.error) {
      lastSent.delete(alert.key);
      console.error('[ops-alert] send failed', result.error.name ?? 'error', result.error.statusCode ?? '');
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    lastSent.delete(alert.key);
    console.error('[ops-alert] send failed', error instanceof Error ? error.name : 'unknown');
    return 'failed';
  }
}

/** For tests. */
export function resetOpsAlertCooldown(): void {
  lastSent.clear();
}

/** Short, safe error code for alerts and responses (no stack, no values). */
export function safeErrorCode(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.replace(/[\r\n]+/g, ' ').replace(/(postgres(ql)?:\/\/)[^\s]+/gi, '$1***').slice(0, 160);
}
