/**
 * /api/mcp credential: `Authorization: Bearer SUPPORT_MCP_TOKEN` (SPEC §6). Pure.
 * Both sides are hashed before timingSafeEqual (no length leak, no throw on length mismatch).
 * A token shorter than 32 chars counts as "not configured" (503), never as valid.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export const MIN_MCP_TOKEN_LENGTH = 32

export type McpAuthResult = { ok: true } | { ok: false; status: 401 | 503 }

export function checkMcpBearer(header: string | null | undefined, token: string | undefined): McpAuthResult {
  const expected = (token || '').trim()
  if (expected.length < MIN_MCP_TOKEN_LENGTH) return { ok: false, status: 503 }
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(header || ''))
  if (!m) return { ok: false, status: 401 }
  const a = createHash('sha256').update(m[1]).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401 }
}
