'use client'

import { useEffect, useState } from 'react'

let cachedPlan: string | null = null
let inflight: Promise<string | null> | null = null

function load(): Promise<string | null> {
  if (cachedPlan) return Promise.resolve(cachedPlan)
  if (inflight) return inflight
  inflight = fetch('/api/billing/current', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const name = typeof json?.data?.name === 'string' ? json.data.name.trim().toUpperCase() : ''
      cachedPlan = name || null
      return cachedPlan
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Real plan tier of the active tenant (FREE / BASIC / PRO), or `null` while unknown / on error. */
export function useTenantPlan(): string | null {
  const [plan, setPlan] = useState<string | null>(cachedPlan)
  useEffect(() => {
    let cancelled = false
    load().then((value) => {
      if (!cancelled && value) setPlan(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return plan
}
