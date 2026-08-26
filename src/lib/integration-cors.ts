const DEFAULT_PRODUCTION_ORIGINS = ['https://betsycrm.com', 'https://www.betsycrm.com'];
const DEFAULT_DEVELOPMENT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getIntegrationAllowedOrigins(
  nodeEnv = process.env.NODE_ENV,
  configured = process.env.INTEGRATION_ALLOWED_ORIGINS || '',
): ReadonlySet<string> {
  const configuredOrigins = configured
    .split(',')
    .map(normalizeOrigin)
    .filter((value): value is string => Boolean(value));

  const defaults = nodeEnv === 'production'
    ? DEFAULT_PRODUCTION_ORIGINS
    : [...DEFAULT_PRODUCTION_ORIGINS, ...DEFAULT_DEVELOPMENT_ORIGINS];

  return new Set([...defaults, ...configuredOrigins]);
}

export function isIntegrationOriginAllowed(
  origin: string | null,
  nodeEnv = process.env.NODE_ENV,
  configured = process.env.INTEGRATION_ALLOWED_ORIGINS || '',
): boolean {
  // API-key integrations without an Origin header are server-to-server.
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && getIntegrationAllowedOrigins(nodeEnv, configured).has(normalized));
}
