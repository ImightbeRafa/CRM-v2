import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://34154b8e86072342dbf9c6e55236e963@o4511109425725440.ingest.us.sentry.io/4511109427494912",

  tracesSampleRate: 0.2,

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracePropagationTargets: ["localhost", /^https:\/\/betsycrm\.com\/api/],

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  sendDefaultPii: false,
});
