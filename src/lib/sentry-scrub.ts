/**
 * One-time tokens (reset / verification / invite links) must never reach Sentry, raw or
 * URL-encoded (e.g. inside `callbackUrl=%2Fauth%2Fverify-email%3Ftoken%3D…`). Shared by the
 * browser, server and edge Sentry configs. No imports: safe everywhere.
 */
const RAW = /([?&#](?:token|code)=)[^&#\s"']+/gi
const ENCODED = /((?:%3F|%26|%23)(?:token|code)%3D)[^&#\s"'%]+(?:%[0-9A-F]{2}[^&#\s"'%]*)*/gi

export function scrubTokens(value: string): string {
  return value.replace(RAW, '$1[redacted]').replace(ENCODED, '$1[redacted]')
}

export function scrubEvent<T>(event: T): T {
  if (event == null) return event
  try {
    return JSON.parse(scrubTokens(JSON.stringify(event))) as T
  } catch {
    return event
  }
}
