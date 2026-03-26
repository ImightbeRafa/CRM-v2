// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://34154b8e86072342dbf9c6e55236e963@o4511109425725440.ingest.us.sentry.io/4511109427494912",

  tracesSampleRate: 0.2,

  enableLogs: true,

  sendDefaultPii: false,
});
