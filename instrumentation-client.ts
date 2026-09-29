import * as Sentry from "@sentry/nextjs";

// One-time tokens (reset / verification / invite links) must never leave in a URL.
const scrubTokens = (value: string) => value.replace(/([?&#](?:token|code)=)[^&#\s"]+/gi, "$1[redacted]");
const scrubEvent = <T,>(event: T): T => JSON.parse(scrubTokens(JSON.stringify(event))) as T;

Sentry.init({
  dsn: "https://34154b8e86072342dbf9c6e55236e963@o4511109425725440.ingest.us.sentry.io/4511109427494912",
  // Our own relay (allow-listed DSN, body only): avoids the Sentry 403 and ad-blockers.
  tunnel: "/monitoring",
  beforeSend: (event) => scrubEvent(event),
  beforeSendTransaction: (event) => scrubEvent(event),
  beforeBreadcrumb: (crumb) => scrubEvent(crumb),

  tracesSampleRate: 0.2,

  integrations: [
    Sentry.browserTracingIntegration(),
    // Explicit (defaults today): never record customer text or media in replays (Ley 8968).
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      // Replays also carry URLs (navigation spans): same token scrub.
      // Only meta (4) / custom (5) events carry URLs; DOM snapshots are left alone (size).
      beforeAddRecordingEvent: (event) =>
        (event as { type?: number }).type === 4 || (event as { type?: number }).type === 5 ? scrubEvent(event) : event,
    }),
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  tracePropagationTargets: ["localhost", /^https:\/\/(www\.)?betsycrm\.com\/api/],

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
