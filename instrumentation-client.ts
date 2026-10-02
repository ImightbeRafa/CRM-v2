// Betsy's own error tracking (Sentry removed 2026-10-02): uncaught browser errors and unhandled
// promise rejections go to /api/client-errors (same origin, scrubbed, capped).
import { installClientErrorListeners } from "./src/lib/observability/client-report";

installClientErrorListeners();
