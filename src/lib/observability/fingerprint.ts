/**
 * Stable id for "the same error": source + error name + message with the variable parts removed
 * (numbers, ids) + the top app frames without line / column. No imports (browser + server).
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':id')
    .replace(/\bc[a-z0-9]{20,30}\b/g, ':id')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

export function topFrames(stack: string | undefined, count = 3): string[] {
  if (!stack) return []
  return stack
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') && !l.includes('node_modules') && !l.includes('node:internal'))
    .map((l) => l.replace(/:\d+:\d+\)?$/, '').replace(/\?[^\s)]*/, ''))
    .slice(0, count)
}

/** FNV-1a 64-bit as hex: deterministic, fast, same result in the browser and on the server. */
export function hashString(input: string): string {
  let h = BigInt('0xcbf29ce484222325')
  const prime = BigInt('0x100000001b3')
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1)
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i))
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

export function errorFingerprint(input: { source: string; name: string; message: string; stack?: string }): string {
  const parts = [input.source, input.name, normalizeErrorMessage(input.message), ...topFrames(input.stack)]
  return `${input.source}:${hashString(parts.join('|'))}`
}
