'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { AuroraShell } from '../AuroraShell'
import { AuroraMobileNav } from '../AuroraMobileNav'
import { ConfigSectionSelect } from './ConfigSectionSelect'
import { ConfigSubNav } from './ConfigSubNav'
import { ConfigTopbar } from './ConfigTopbar'
import { useChannelsNeedingAction } from './useChannelsNeedingAction'

type ConfigShellProps = {
  activeTab: string
  /** Optimistic tab highlight (the sub-nav Links do the navigation). */
  onSelectTab?: (tab: string) => void
  children: ReactNode
}

type ConfigTrailValue = { trail: string[]; setTrail: (trail: string[]) => void }

/** Extra breadcrumb crumbs a panel can push after its own label (e.g. `[agente, tab]` for Agentes IA). */
const ConfigTrailContext = createContext<ConfigTrailValue>({ trail: [], setTrail: () => {} })

export function useConfigTrail(): ConfigTrailValue {
  return useContext(ConfigTrailContext)
}

function ChannelsAwareMobileNav({ activeTab }: { activeTab: string }) {
  const needs = useChannelsNeedingAction()
  return <AuroraMobileNav configTab={activeTab} channelsAlert={needs > 0} />
}

/**
 * The one Config chrome: AuroraShell + topbar + persistent sub-nav + scrolling centre panel.
 * `.aurora-light` keeps shadcn tokens light inside the panel even under `html.dark`.
 */
export function ConfigShell({ activeTab, onSelectTab, children }: ConfigShellProps) {
  const { data: session } = useSession()
  const canSeeChannels = hasSessionPermission(session, 'update_config')
  const [trail, setTrail] = useState<string[]>([])
  const trailValue = useMemo(() => ({ trail, setTrail }), [trail])
  return (
    <ConfigTrailContext.Provider value={trailValue}>
    <AuroraShell fullBleed bottomNav={
        canSeeChannels ? <ChannelsAwareMobileNav activeTab={activeTab} /> : <AuroraMobileNav configTab={activeTab} />
      }>
      <ConfigTopbar activeTab={activeTab} trail={activeTab === 'agentes' ? trail : []} />
      <ConfigSectionSelect activeTab={activeTab} onSelectTab={onSelectTab} />
      <div className="flex min-h-0 flex-1">
        <ConfigSubNav activeTab={activeTab} onSelectTab={onSelectTab} showChannelsBadge={canSeeChannels} />
        <section
          id="config-panel"
          data-testid="config-panel"
          className="aurora-light min-w-0 flex-1 overflow-y-auto bg-[var(--aurora-canvas)] text-slate-900 [color-scheme:light]"
        >
          <div className="mx-auto w-full max-w-[1100px] px-4 pb-48 pt-5 md:px-10 md:pb-28 md:pt-8">{children}</div>
        </section>
      </div>
    </AuroraShell>
    </ConfigTrailContext.Provider>
  )
}
