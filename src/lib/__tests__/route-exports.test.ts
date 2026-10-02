import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Next.js refuses to build a route file that exports anything but handlers and route config
 * ("does not match the required types of a Next.js Route"). Caught by a Docker build on
 * 2026-10-02 (ops-daily exported a constant); this keeps it from reaching a deploy.
 */
const ALLOWED = new Set([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
  'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration', 'generateStaticParams',
])

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) routeFiles(p, out)
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p)
  }
  return out
}

test('route files only export handlers and route config', () => {
  const bad: string[] = []
  for (const file of routeFiles('src/app')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z0-9_$]+)/gm)) {
      if (!ALLOWED.has(m[1]!)) bad.push(`${file}: ${m[1]}`)
    }
    for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
      for (const part of m[1]!.split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()!.trim()
        if (name && !name.startsWith('type ') && !ALLOWED.has(name)) bad.push(`${file}: ${name}`)
      }
    }
  }
  assert.deepEqual(bad, [])
})
