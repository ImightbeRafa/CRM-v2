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
  /** Database connection errors the app saw in its last 5 min (watchdog's authenticated check only). */
  connErrors?: number;
  cause?: HealthCause;
  /** Short raw detail (status + first bytes of the body, or the error name). */
  detail: string;
};

/** An outage being tracked (failed rounds in a row). */
export type HealthOutage = {
  /** First failed check of this outage (ISO). */
  since: string;
  /** Last failed round (ISO): the outage ended between this and the first OK round. */
  lastFailedAt: string;
  cause: HealthCause;
  detail: string;
  /** Last "down" email (ISO): repeats at most every hour. UNSENT_EMAIL_AT until one went out. */
  lastEmailAt: string;
  /** Rounds (one every 5 min) where both checks failed. */
  failedRounds: number;
  /** A "down" email went out (so recovery gets an email too). A one-round blip never emails. */
  emailed: boolean;
};

/** Site up but the database slow / connections failing (warning before a full outage). */
export type HealthDegraded = {
  since: string;
  /** Slow rounds in a row; email after DEGRADED_ROUNDS. */
  slowRounds: number;
  /** Normal rounds in a row since the last slow one; clears after DEGRADED_CLEAR_ROUNDS. */
  okRounds: number;
  emailed: boolean;
  /** Worst database time / connection-error count seen. */
  worstDbMs: number;
  worstConnErrors: number;
};

/**
 * Watchdog state, shared by every Cloudflare data center (Durable Object storage). It was an edge-cache
 * entry per data center: on 2026-10-23 two data centers each saw one failed check and each later sent
 * "volvió a responder (caído ~1 h)" for a ~15 min blip.
 */
export type WatchState = {
  outage: HealthOutage | null;
  degraded: HealthDegraded | null;
  /** Last round that wrote the state (ISO): older than WATCH_STATE_STALE_MS = crons paused, discarded. */
  updatedAt: string;
};

export type WatchEmail = "down" | "remind" | "up" | "degraded" | "degraded_clear";

/** Failed rounds in a row before the first "down" email (~5 min; each round already retries after 20 s). */
export const DOWN_ROUNDS = 2;
/** Database slower than this on the health check counts as a slow round. */
export const DEGRADED_DB_MS = 2_000;
/** Connection errors in the app's last 5 min that count as a slow round. */
export const DEGRADED_CONN_ERRORS = 5;
export const DEGRADED_ROUNDS = 2;
export const DEGRADED_CLEAR_ROUNDS = 2;
/** State not updated for this long (crons paused / DISABLE_CRONS): dropped without any email. */
export const WATCH_STATE_STALE_MS = 2 * 60 * 60_000;

/** How long the watchdog waits for /api/health before calling it "no answer". */
export const HEALTH_CHECK_TIMEOUT_MS = 15_000;
export const HEALTH_REMIND_EVERY_MS = 60 * 60_000;
/** `lastEmailAt` when Resend did not accept the email: the next failed round sends again. */
export const UNSENT_EMAIL_AT = "1970-01-01T00:00:00.000Z";

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

/** Connection errors the app saw in its last 5 min (only in the watchdog's own authenticated check). */
export function parseConnErrors(body: string): number | undefined {
  const m = /"connErrors5m"\s*:\s*(\d{1,6})/.exec(body);
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

/** First "down" email of an outage (after DOWN_ROUNDS failed rounds), or the hourly reminder. */
export function buildDownEmail(outage: HealthOutage, checks: HealthCheck[], now: string, reminder = false): { subject: string; text: string } {
  const info = CAUSE[outage.cause];
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
  // It ended somewhere between the last failed round and this first OK round (checks every 5 min).
  const lastFailedAt = outage.lastFailedAt || outage.since;
  const atLeast = humanDuration(Date.parse(lastFailedAt) - Date.parse(outage.since));
  const atMost = humanDuration(Date.parse(now) - Date.parse(outage.since));
  const range = atLeast === atMost ? `unos ${atMost}` : `entre ${atLeast} y ${atMost}`;
  return {
    subject: `www.betsycrm.com volvió a responder (caído ~${atMost})`,
    text: [
      nowLine,
      "",
      `Estuvo caído desde ${crTime(outage.since, true)} hora CR (${utcTime(outage.since)} UTC). Último fallo visto: ${crTime(lastFailedAt)}; ya contesta a las ${crTime(now)}. Duración: ${range}.`,
      `Causa: ${CAUSE[outage.cause].what}`,
      `Primer error visto: ${outage.detail}`,
      `Revisiones fallidas seguidas: ${outage.failedRounds} (se revisa cada 5 min).`,
      "Los mensajes de WhatsApp/Instagram de ese rato: Meta los vuelve a mandar cuando Betsy no los pudo guardar.",
      "",
      outage.cause === "db_timeout" || outage.cause === "db_error"
        ? "No hace falta hacer nada si no se repite. Si pasa seguido, conviene revisar el plan / uso de Supabase."
        : "No hace falta hacer nada si no se repite. Si pasa seguido, revisá los logs del Worker en Cloudflare.",
    ].join("\n"),
  };
}

/** Site answers but the database is slow / connections fail (one email per episode, and one when it clears). */
export function buildDegradedEmail(d: HealthDegraded, check: HealthCheck, now: string, cleared: boolean): { subject: string; text: string } {
  if (cleared) {
    return {
      subject: "www.betsycrm.com: la base de datos volvió a la normalidad",
      text: [
        `Desde ${crTime(d.since, true)} hasta ${crTime(now)} hora CR la base de datos estuvo lenta o con conexiones fallidas (${humanDuration(Date.parse(now) - Date.parse(d.since))}).`,
        `Peor momento: base de datos ${d.worstDbMs} ms, ${d.worstConnErrors} conexiones fallidas en 5 min.`,
        `Ahora: base de datos ${check.dbMs ?? "?"} ms. No hace falta hacer nada si no se repite.`,
      ].join("\n"),
    };
  }
  return {
    subject: "www.betsycrm.com sigue arriba, pero la base de datos está lenta",
    text: [
      "QUÉ PASA: el sitio responde, pero la base de datos (Supabase) está lenta o rechaza conexiones. Puede ser el aviso antes de un corte.",
      `Desde: ${crTime(d.since, true)} hora CR (${utcTime(d.since)} UTC).`,
      `Ahora: base de datos ${check.dbMs ?? "?"} ms, ${check.connErrors ?? 0} conexiones fallidas en los últimos 5 min (normal: menos de 300 ms y 0).`,
      "",
      "QUÉ HACER:",
      "  • Nada todavía si dura pocos minutos. Si llega el correo de \"NO responde\", ahí sí es un corte.",
      "  • Si se repite seguido: en el panel de Supabase mirá CPU, conexiones y \"checkpoints\".",
      "",
      "Te llega otro correo cuando vuelva a la normalidad.",
    ].join("\n"),
  };
}

function isSlow(check: HealthCheck): boolean {
  return (check.dbMs ?? 0) > DEGRADED_DB_MS || (check.connErrors ?? 0) >= DEGRADED_CONN_ERRORS;
}

/**
 * One watchdog round → the state to store and the emails to send. Pure.
 * - Down: email only after DOWN_ROUNDS failed rounds in a row (a single failed round is a blip: no email);
 *   then a reminder every hour; "up" on the first OK round, only when "down" went out.
 * - Degraded (site up, database slow): email after DEGRADED_ROUNDS slow rounds, "cleared" after
 *   DEGRADED_CLEAR_ROUNDS normal rounds. Never during an outage.
 * - State older than WATCH_STATE_STALE_MS is dropped (crons were paused): no "recovered after 3 days".
 * - `downRounds: 1` when the shared state could not be read (per-data-center fallback): rounds move between
 *   data centers, so waiting for 2 in the same one could delay the email for a long time.
 */
export function planWatchRound(
  previous: WatchState | null,
  checks: HealthCheck[],
  now: string,
  opts: { downRounds?: number } = {},
): { state: WatchState | null; emails: WatchEmail[] } {
  const downRounds = opts.downRounds ?? DOWN_ROUNDS;
  const fresh = previous && Date.parse(now) - Date.parse(previous.updatedAt) <= WATCH_STATE_STALE_MS ? previous : null;
  let outage = fresh?.outage ?? null;
  let degraded = fresh?.degraded ?? null;
  const emails: WatchEmail[] = [];
  const last = checks[checks.length - 1];

  if (!last.ok) {
    if (!outage) {
      // `detail` from the same check as `cause`, so both describe one failure.
      outage = { since: checks[0].at, lastFailedAt: now, cause: last.cause ?? "app_error", detail: last.detail, lastEmailAt: UNSENT_EMAIL_AT, failedRounds: 1, emailed: false };
    } else {
      // The cause can change mid-outage (Supabase slow → container down): emails use the latest.
      outage = { ...outage, lastFailedAt: now, cause: last.cause ?? outage.cause, failedRounds: outage.failedRounds + 1 };
    }
    if (!outage.emailed && outage.failedRounds >= downRounds) {
      outage = { ...outage, emailed: true, lastEmailAt: now };
      emails.push("down");
    } else if (outage.emailed && Date.parse(now) - Date.parse(outage.lastEmailAt) >= HEALTH_REMIND_EVERY_MS) {
      outage = { ...outage, lastEmailAt: now };
      emails.push("remind");
    }
    // A real outage (emailed) replaces the "slow" episode; a one-round blip keeps it, so its promised
    // "back to normal" email still comes.
    if (outage.emailed) degraded = null;
  } else {
    if (outage?.emailed) emails.push("up");
    outage = null;
    if (isSlow(last)) {
      const base: HealthDegraded = degraded ?? { since: checks[0].at, slowRounds: 0, okRounds: 0, emailed: false, worstDbMs: 0, worstConnErrors: 0 };
      degraded = {
        ...base,
        slowRounds: base.slowRounds + 1,
        okRounds: 0,
        worstDbMs: Math.max(base.worstDbMs, last.dbMs ?? 0),
        worstConnErrors: Math.max(base.worstConnErrors, last.connErrors ?? 0),
      };
      if (!degraded.emailed && degraded.slowRounds >= DEGRADED_ROUNDS) {
        degraded = { ...degraded, emailed: true };
        emails.push("degraded");
      }
    } else if (degraded) {
      degraded = { ...degraded, okRounds: degraded.okRounds + 1 };
      if (degraded.okRounds >= DEGRADED_CLEAR_ROUNDS) {
        if (degraded.emailed) emails.push("degraded_clear");
        degraded = null;
      }
    }
  }
  if (!outage && !degraded) return { state: null, emails };
  return { state: { outage, degraded, updatedAt: now }, emails };
}

function causeOk(v: unknown): v is HealthCause {
  return typeof v === "string" && v in CAUSE;
}

/** Stored JSON → state, or null when missing / unreadable (never throws). */
export function parseWatchState(raw: string | null | undefined): WatchState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WatchState>;
    if (typeof v?.updatedAt !== "string") return null;
    const o = v.outage as Partial<HealthOutage> | null | undefined;
    const outage: HealthOutage | null =
      o && typeof o.since === "string" && causeOk(o.cause)
        ? {
            since: o.since,
            lastFailedAt: typeof o.lastFailedAt === "string" ? o.lastFailedAt : o.since,
            cause: o.cause,
            detail: typeof o.detail === "string" ? o.detail : "",
            lastEmailAt: typeof o.lastEmailAt === "string" ? o.lastEmailAt : UNSENT_EMAIL_AT,
            failedRounds: typeof o.failedRounds === "number" ? o.failedRounds : 1,
            emailed: o.emailed === true,
          }
        : null;
    const d = v.degraded as Partial<HealthDegraded> | null | undefined;
    const degraded: HealthDegraded | null =
      d && typeof d.since === "string"
        ? {
            since: d.since,
            slowRounds: typeof d.slowRounds === "number" ? d.slowRounds : 1,
            okRounds: typeof d.okRounds === "number" ? d.okRounds : 0,
            emailed: d.emailed === true,
            worstDbMs: typeof d.worstDbMs === "number" ? d.worstDbMs : 0,
            worstConnErrors: typeof d.worstConnErrors === "number" ? d.worstConnErrors : 0,
          }
        : null;
    return { outage, degraded, updatedAt: v.updatedAt };
  } catch {
    return null;
  }
}
