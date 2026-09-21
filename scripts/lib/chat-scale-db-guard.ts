/**
 * Shared safety gate for chat Phase 4 scale tooling.
 * NEVER point these scripts at shared Supabase / pooler / non-loopback hosts.
 */

export type ChatScaleDbGuardOk = {
  ok: true
  url: string
  hostname: string
  port: string
}

export type ChatScaleDbGuardFail = {
  ok: false
  reason: string
}

export type ChatScaleDbGuardResult = ChatScaleDbGuardOk | ChatScaleDbGuardFail

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function assertChatScaleDatabaseUrl(
  rawUrl: string | undefined | null,
  envName = 'CHAT_SCALE_DATABASE_URL',
): ChatScaleDbGuardResult {
  const url = (rawUrl || '').trim()
  if (!url) {
    return {
      ok: false,
      reason:
        `${envName} is required. Refusing to use DATABASE_URL / DIRECT_URL ` +
        '(those often point at shared Supabase).',
    }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: `${envName} is not a valid URL` }
  }

  if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
    return {
      ok: false,
      reason: `${envName} must be a postgres:// or postgresql:// URL (got ${parsed.protocol})`,
    }
  }

  const hostnameRaw = parsed.hostname.toLowerCase()
  // Node URL keeps brackets for IPv6 literals in some cases; normalize.
  const hostname = hostnameRaw.replace(/^\[|\]$/g, '')
  const port = parsed.port || '5432'

  const looksSupabase =
    hostname.includes('supabase.co') ||
    hostname.includes('supabase.com') ||
    hostname.includes('pooler.supabase')

  if (looksSupabase) {
    return {
      ok: false,
      reason: `Refusing Supabase host "${parsed.hostname}". Scale seed/bench is local-only.`,
    }
  }

  if (port === '6543') {
    return {
      ok: false,
      reason: 'Refusing transaction pooler port 6543. Use a local direct Postgres (5432).',
    }
  }

  if (!LOOPBACK_HOSTS.has(hostname)) {
    return {
      ok: false,
      reason:
        `Refusing non-loopback host "${parsed.hostname}". ` +
        'CHAT_SCALE_DATABASE_URL must target localhost / 127.0.0.1 / ::1.',
    }
  }

  return { ok: true, url, hostname: parsed.hostname, port }
}

export function requireChatScaleDatabaseUrl(
  rawUrl: string | undefined | null = process.env.CHAT_SCALE_DATABASE_URL,
): ChatScaleDbGuardOk {
  const result = assertChatScaleDatabaseUrl(rawUrl)
  if (!result.ok) {
    console.error(`\n❌ chat-scale blocked: ${result.reason}\n`)
    process.exit(1)
  }
  return result
}

export function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return NaN
  const idx = Math.min(sortedMs.length - 1, Math.max(0, Math.ceil((p / 100) * sortedMs.length) - 1))
  return sortedMs[idx]!
}

export function summarizeLatencies(samplesMs: number[]): {
  count: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  meanMs: number
} {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, n) => acc + n, 0)
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    minMs: sorted[0] ?? NaN,
    maxMs: sorted[sorted.length - 1] ?? NaN,
    meanMs: sorted.length ? sum / sorted.length : NaN,
  }
}
