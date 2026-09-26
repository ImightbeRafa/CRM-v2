import { redirect } from 'next/navigation'
import { normalizeConfigSearch } from '@/components/aurora/config/config-nav'
import ConfigPageClient from './ConfigPageClient'

type SearchParams = Record<string, string | string[] | undefined>

function toURLSearchParams(sp: SearchParams): URLSearchParams {
  const out = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) value.forEach((v) => out.append(key, v))
    else if (value !== undefined) out.append(key, value)
  }
  return out
}

/**
 * `/config?tab=<slug>` — single Config layout (see ConfigPageClient).
 * Non-canonical `?tab=` values (Spanish aliases, hub, unknown, staff-only) get a real
 * 307 to the canonical URL, keeping every other param (Tilopay / OAuth returns).
 */
export default async function ConfigPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { href, changed } = normalizeConfigSearch(toURLSearchParams(await searchParams))
  if (changed) redirect(href)
  return <ConfigPageClient />
}
