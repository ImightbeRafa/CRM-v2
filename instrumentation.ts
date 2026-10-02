// Betsy's own error tracking (Sentry removed 2026-10-02): see src/lib/observability/report-error.ts.

export async function register() {
  try {
    if (typeof (globalThis as any).self === 'undefined') {
      (globalThis as any).self = globalThis as any;
    }
  } catch {
    // no-op
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installConsoleErrorCapture } = await import('./src/lib/observability/report-error');
    installConsoleErrorCapture();
  }
}

/** Unhandled errors in route handlers, server components, server actions and middleware. */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routeType?: string; routePath?: string },
) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    // Edge: log only (Workers Logs); no DB access there.
    console.error(JSON.stringify({ level: 'error', kind: 'betsy.error', source: 'edge', route: context?.routePath ?? request?.path?.split('?')[0], name: error instanceof Error ? error.name : 'Error' }));
    return;
  }
  const { reportError, reportFromError } = await import('./src/lib/observability/report-error');
  reportError(reportFromError(error, 'server', context?.routePath ?? request?.path?.split('?')[0] ?? null));
}
