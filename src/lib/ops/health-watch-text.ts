/**
 * Plain-language texts for the Worker uptime watchdog (src/cf-container-worker.ts). Pure: no
 * Worker or Node APIs, so the same code runs in the Worker bundle and in node:test.
 * The emails only carry what the public /api/health answer already shows (no customer data).
 */

export type HealthCause = "db_timeout" | "db_error" | "app_error" | "app_unreachable" | "no_answer";

export type HealthCheck = {
  /** ISO time the check started. */
  at: string;
  ok: boolean;
  /** HTTP status from the container, 0 when nothing came back. */
  status: number;
  /** Total round trip Worker → container → database → Worker. */
  ms: number;
  /** Database answer time reported by /api/health (only when the app answered with it). */
  dbMs?: number;
  cause?: HealthCause;
  /** Short raw detail (status + first bytes of the body, or the error name). */
  detail: string;
};

/** What the edge-cache marker holds while the site is down. */
export type HealthOutage = {
  /** First failed check of this outage (ISO). */
  since: string;
  cause: HealthCause;
  detail: string;
  /** Last "down" email (ISO): repeats at most every hour. */
  lastEmailAt: string;
  /** Rounds (one every 5 min) where both checks failed. */
  failedRounds: number;
};

/** How long the watchdog waits for /api/health before calling it "no answer". */
export const HEALTH_CHECK_TIMEOUT_MS = 15_000;
export const HEALTH_REMIND_EVERY_MS = 60 * 60_000;

/** Reads what /api/health and the Worker's own 503 page say into one of five causes. */
export function classifyHealth(status: number, body: string, thrown?: string): HealthCause | undefined {
  if (thrown === "timeout") return "no_answer";
  if (thrown) return "app_unreachable";
  if (status >= 200 && status < 300) return undefined;
  if (/"db"\s*:\s*"timeout"/.test(body)) return "db_timeout";
  if (/"db"\s*:\s*"error"/.test(body)) return "db_error";
  // fetchWithFailover's own answer when neither container object responds.
  if (status === 503 && /temporalmente no disponible/.test(body)) return "app_unreachable";
  return "app_error";
}

export function parseDbMs(body: string): number | undefined {
  const m = /"dbMs"\s*:\s*(\d{1,6})/.exec(body);
  return m ? Number(m[1]) : undefined;
}

const CAUSE: Record<HealthCause, { what: string; who: string; todo: string[] }> = {
  db_timeout: {
    what: "La base de datos (Supabase) tardó más de 3 segundos en contestar.",
    who: "Supabase",
    todo: [
      "Casi siempre es un corte corto de Supabase y se arregla solo en pocos minutos.",
      "Si sigue más de 15 min: mirá https://status.supabase.com y, en el panel de Supabase, el uso de conexiones y CPU.",
    ],
  },
  db_error: {
    what: "La base de datos (Supabase) rechazó la conexión o devolvió un error.",
    who: "Supabase",
    todo: [
      "Mirá https://status.supabase.com y, en el panel de Supabase, si el proyecto está pausado o sin conexiones libres.",
      "Si Supabase está bien: revisá que DATABASE_URL del Worker no haya cambiado.",
    ],
  },
  app_error: {
    what: "La app contestó con un error (la base de datos no es el problema).",
    who: "la app (contenedor)",
    todo: [
      "Mirá los errores recientes en https://www.betsycrm.com/super-admin/salud (si abre).",
      "Mirá los logs del Worker en Cloudflare (enlace abajo). Si empezó justo después de un deploy, volvé a la versión anterior.",
    ],
  },
  app_unreachable: {
    what: "El contenedor de la app no contesta (ni el principal ni el de respaldo).",
    who: "Cloudflare Containers",
    todo: [
      "Mirá https://www.cloudflarestatus.com y los logs del Worker en Cloudflare (enlace abajo).",
      "Si sigue más de 10 min: un nuevo deploy (npx wrangler deploy --keep-vars desde la carpeta live) reinicia el contenedor.",
    ],
  },
  no_answer: {
    what: `La app no contestó en ${HEALTH_CHECK_TIMEOUT_MS / 1000} segundos (está colgada o arrancando).`,
    who: "la app (contenedor)",
    todo: [
      "Si acaba de haber un deploy, esperá 2–3 min: el contenedor está arrancando.",
      "Si no: mirá los logs del Worker en Cloudflare (enlace abajo).",
    ],
  },
};

const SHORT: Record<HealthCause, string> = {
  db_timeout: "base de datos lenta",
  db_error: "base de datos con error",
  app_error: "la app da error",
  app_unreachable: "la app no arranca",
  no_answer: "la app no contesta",
};

const CF_LOGS =
  "https://dash.cloudflare.com/?to=/:account/workers/services/view/betsy-crm-daytime-smoke/production/observability/logs";

/** Costa Rica is UTC-6 all year (no daylight saving). */
export function crTime(iso: string, withDate = false): string {
  const d = new Date(new Date(iso).getTime() - 6 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return withDate ? `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${time}` : time;
}

function utcTime(iso: string): string {
  return iso.slice(11, 16);
}

export function humanDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

function checkLine(c: HealthCheck, n: number): string {
  const db = c.dbMs !== undefined ? `, base de datos ${c.dbMs} ms` : "";
  return `  ${n}) ${crTime(c.at)} — ${c.detail} (tardó ${(c.ms / 1000).toFixed(1)} s${db})`;
}

/** First "down" email of an outage, or the hourly reminder when `outage.failedRounds > 1`. */
export function buildDownEmail(outage: HealthOutage, checks: HealthCheck[], now: string): { subject: string; text: string } {
  const info = CAUSE[outage.cause];
  const reminder = outage.failedRounds > 1;
  const elapsed = humanDuration(Date.parse(now) - Date.parse(outage.since));
  const subject = reminder
    ? `www.betsycrm.com SIGUE sin responder (${elapsed}) — ${SHORT[outage.cause]}`
    : `www.betsycrm.com NO responde — ${SHORT[outage.cause]}`;
  const lines = [
    `QUÉ PASA: ${info.what}`,
    `Dónde está el problema: ${info.who}.`,
    `Qué ven los clientes: el sitio no carga o muestra "volvemos enseguida"; los mensajes de WhatsApp/Instagram esperan y Meta los reintenta.`,
    "",
    `Desde: ${crTime(outage.since, true)} hora CR (${utcTime(outage.since)} UTC)${reminder ? ` — lleva ${elapsed}` : ""}`,
    `Intentos de esta revisión (20 s entre uno y otro):`,
    ...checks.map((c, i) => checkLine(c, i + 1)),
    "",
    "QUÉ HACER:",
    ...info.todo.map((t) => `  • ${t}`),
    "",
    "Enlaces:",
    `  • Logs del Worker (betsy-crm-daytime-smoke): ${CF_LOGS}`,
    "  • Estado de Supabase: https://status.supabase.com",
    "  • Estado de Cloudflare: https://www.cloudflarestatus.com",
    "",
    "Cuando vuelva a responder te llega otro correo con cuánto duró. Si sigue caído, un recordatorio cada hora.",
  ];
  return { subject, text: lines.join("\n") };
}

export function buildUpEmail(outage: HealthOutage | null, check: HealthCheck, now: string): { subject: string; text: string } {
  const speed = check.dbMs !== undefined ? `base de datos ${check.dbMs} ms, ` : "";
  const nowLine = `Ahora: todo contesta (${speed}respuesta total ${(check.ms / 1000).toFixed(1)} s).`;
  if (!outage) {
    // Marker from the previous watchdog version (no details stored).
    return {
      subject: "www.betsycrm.com volvió a responder",
      text: [nowLine, `Hora: ${crTime(now, true)} hora CR (${utcTime(now)} UTC)`].join("\n"),
    };
  }
  const duration = humanDuration(Date.parse(now) - Date.parse(outage.since));
  return {
    subject: `www.betsycrm.com volvió a responder (caído ~${duration})`,
    text: [
      nowLine,
      "",
      `Estuvo caído: de ${crTime(outage.since, true)} a ${crTime(now)} hora CR (${utcTime(outage.since)}–${utcTime(now)} UTC), unos ${duration}.`,
      `Causa: ${CAUSE[outage.cause].what}`,
      `Primer error visto: ${outage.detail}`,
      `Revisiones fallidas: ${outage.failedRounds} (se revisa cada 5 min: los horarios son aproximados, ±5 min).`,
      "",
      outage.cause === "db_timeout" || outage.cause === "db_error"
        ? "No hace falta hacer nada si no se repite. Si pasa seguido, conviene revisar el plan / uso de Supabase."
        : "No hace falta hacer nada si no se repite. Si pasa seguido, revisá los logs del Worker en Cloudflare.",
    ].join("\n"),
  };
}

/**
 * One failed round (both checks down) → the outage to store and whether to email now.
 * `hadMarker` without `previous` = marker from the previous watchdog version ("1"): it already
 * emailed within the hour, so start tracking without a second email.
 */
export function planDownRound(
  hadMarker: boolean,
  previous: HealthOutage | null,
  checks: HealthCheck[],
  now: string,
): { outage: HealthOutage; email: boolean } {
  if (previous) {
    const email = Date.parse(now) - Date.parse(previous.lastEmailAt) >= HEALTH_REMIND_EVERY_MS;
    return {
      outage: { ...previous, failedRounds: previous.failedRounds + 1, lastEmailAt: email ? now : previous.lastEmailAt },
      email,
    };
  }
  const first = checks[0];
  const last = checks[checks.length - 1];
  return {
    outage: { since: first.at, cause: last.cause ?? "app_error", detail: first.detail, lastEmailAt: now, failedRounds: 1 },
    email: !hadMarker,
  };
}

/** Marker body → outage, or null when it is the old "1" marker / unreadable. */
export function parseOutage(raw: string): HealthOutage | null {
  try {
    const v = JSON.parse(raw) as Partial<HealthOutage>;
    if (typeof v?.since !== "string" || typeof v.cause !== "string" || !(v.cause in CAUSE)) return null;
    return {
      since: v.since,
      cause: v.cause,
      detail: typeof v.detail === "string" ? v.detail : "",
      lastEmailAt: typeof v.lastEmailAt === "string" ? v.lastEmailAt : v.since,
      failedRounds: typeof v.failedRounds === "number" ? v.failedRounds : 1,
    };
  } catch {
    return null;
  }
}
