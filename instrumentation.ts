import * as Sentry from '@sentry/nextjs';

export async function register() {
  try {
    if (typeof (globalThis as any).self === 'undefined') {
      (globalThis as any).self = globalThis as any;
    }
  } catch {
    // no-op
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
