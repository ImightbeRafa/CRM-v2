'use client'

import type { ReactNode } from 'react'
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
  return (
    <AuroraShell fullBleed bottomNav={
        canSeeChannels ? <ChannelsAwareMobileNav activeTab={activeTab} /> : <AuroraMobileNav configTab={activeTab} />
      }>
      <ConfigTopbar activeTab={activeTab} />
      <ConfigSectionSelect activeTab={activeTab} onSelectTab={onSelectTab} />
      <div className="flex min-h-0 flex-1">
        <ConfigSubNav activeTab={activeTab} onSelectTab={onSelectTab} showChannelsBadge={canSeeChannels} />
        <section
          id="config-panel"
          data-testid="config-panel"
          className="aurora-light min-w-0 flex-1 overflow-y-auto bg-[#F6F5F2] text-slate-900 [color-scheme:light]"
        >
          <div className="mx-auto w-full max-w-[1100px] px-4 py-5 md:px-10 md:py-8">{children}</div>
        </section>
      </div>
    </AuroraShell>
  )
}
