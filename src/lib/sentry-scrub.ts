/**
 * One-time tokens (reset / verification / invite links) must never reach Sentry, raw or
 * URL-encoded (e.g. inside `callbackUrl=%2Fauth%2Fverify-email%3Ftoken%3D…`). Shared by the
 * browser, server and edge Sentry configs. No imports: safe everywhere.
 */
// Backslash excluded too: inside JSON a token may be followed by an escape (\" or \), which the
// match must not swallow (the result would stop being valid JSON).
const RAW = /([?&#](?:token|code)=)[^&#\s"'\\]+/gi
const ENCODED = /((?:%3F|%26|%23)(?:token|code)%3D)[^&#\s"'%\\]+(?:%[0-9A-F]{2}[^&#\s"'%\\]*)*/gi

export function scrubTokens(value: string): string {
  return value.replace(RAW, '$1[redacted]').replace(ENCODED, '$1[redacted]')
}

/** Scrubbed copy, or null (drop the event) when it cannot be scrubbed safely — fail closed. */
export function scrubEvent<T>(event: T): T | null {
  if (event == null) return event
  try {
    return JSON.parse(scrubTokens(JSON.stringify(event))) as T
  } catch {
    return null
  }
}
