import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface TimestampCursor {
  timestamp: string;
  id: string;
}

interface SignedCursorPayload extends TimestampCursor {
  version: 1;
  scope: string;
}

const MAX_CURSOR_LENGTH = 2048;

function cursorSecret() {
  return process.env.NEXTAUTH_SECRET || 'betsy-local-cursor-secret';
}

function signature(payload: string) {
  return createHmac('sha256', cursorSecret()).update(payload).digest('base64url');
}

export function hashCursorScope(parts: Record<string, string | number | boolean | null | undefined>) {
  const canonical = Object.entries(parts)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value ?? '')}`)
    .join('&');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

export function encodeTimestampCursor(cursor: TimestampCursor, scope: string) {
  const payload: SignedCursorPayload = { version: 1, scope, ...cursor };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function decodeTimestampCursor(value: string | null, expectedScope: string): TimestampCursor | null {
  if (!value) return null;
  if (value.length > MAX_CURSOR_LENGTH) throw new Error('Invalid cursor');
  const [encoded, providedSignature, extra] = value.split('.');
  if (!encoded || !providedSignature || extra) throw new Error('Invalid cursor');
  const expectedSignature = signature(encoded);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error('Invalid cursor');
  }

  let payload: SignedCursorPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedCursorPayload;
  } catch {
    throw new Error('Invalid cursor');
  }
  const timestamp = new Date(payload.timestamp);
  if (
    payload.version !== 1
    || payload.scope !== expectedScope
    || !payload.id
    || Number.isNaN(timestamp.getTime())
  ) {
    throw new Error('Invalid cursor');
  }
  return { timestamp: timestamp.toISOString(), id: payload.id };
}

export function parsePageLimit(value: string | null, fallback: number, maximum = 100) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Invalid limit');
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw new Error(`Limit must be between 1 and ${maximum}`);
  return parsed;
}

export function parseOptionalDate(value: string | null, field: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}`);
  return date;
}

export function normalizeStoredStatus(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
