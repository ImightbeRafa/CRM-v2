'use client'

import { useEffect, useState } from 'react'
import { AuroraListSkeleton } from '@/components/aurora/states/AuroraSkeleton'
import { AgentSalesPage } from './AgentSalesPage'

/**
 * Agents tab switch (SPEC §7.3): the business's agent editor when Rafael enabled it
 * (GET /api/agents/access), otherwise the sales page. UI only — the agent APIs enforce
 * the same rule server-side. While SUPPORT_PIPELINE_ENABLED is off everyone keeps the editor.
 */
export function CustomAgentGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'enabled' | 'sales'>('loading')

  useEffect(() => {
    let alive = true
    // A failed check shows the editor: the server gate still decides what it can load.
    fetch('/api/agents/access', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: true }))
      .then((d: { enabled?: boolean }) => {
        if (alive) setState(d.enabled === false ? 'sales' : 'enabled')
      })
      .catch(() => {
        if (alive) setState('enabled')
      })
    return () => {
      alive = false
    }
  }, [])

  if (state === 'loading') return <AuroraListSkeleton rows={5} label="Cargando agentes" />
  if (state === 'sales') return <AgentSalesPage />
  return <>{children}</>
}
