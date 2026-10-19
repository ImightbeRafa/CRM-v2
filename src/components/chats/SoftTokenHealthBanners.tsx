'use client'

import { accountDisplayLabel, type SoftSocialAccount } from '@/lib/chat-soft-copilot'
import { lineHealth } from '@/lib/chat-line-filter'
import { ChannelDownBanner } from '@/components/aurora/states'
import { LINE_DOWN_FIX_TEXT, formatSinceCr } from '@/lib/channel-silence-core'

type Props = {
  accounts: SoftSocialAccount[]
}

const MAX_VISIBLE = 2

/**
 * Line health strip for /chats: one banner per line that needs repair or reconnect,
 * reusing the same health classification as Canales. A silence flag says the line
 * may simply be quiet. Renders outside the bucket / list / rail chrome.
 */
export function SoftTokenHealthBanners({ accounts }: Props) {
  const down = accounts
    .map((account) => ({ account, health: lineHealth(account) }))
    .filter(({ health }) => health.needsAction)
  if (down.length === 0) return null

  const visible = down.slice(0, MAX_VISIBLE)
  const hidden = down.length - visible.length

  return (
    <div data-testid="soft-token-health-banners">
      {visible.map(({ account, health }) => (
        <ChannelDownBanner
          key={account.id}
          message={
            account.silentSince
              ? `${accountDisplayLabel(account)} · sin mensajes recientes desde ${formatSinceCr(new Date(account.silentSince))}. Puede ser un período tranquilo, no necesariamente una desconexión.`
              : `${accountDisplayLabel(account)} · ${health.label.toLowerCase()}. ${
                  account.platform === 'instagram' && health.action === 'reconnect'
                    ? `${LINE_DOWN_FIX_TEXT} en Facebook.`
                    : 'Los mensajes de esta línea pueden no enviarse ni recibirse.'
                }`
          }
          actionLabel={health.action === 'repair' ? 'Reparar' : 'Reconectar'}
        />
      ))}
      {hidden > 0 ? (
        <ChannelDownBanner message={`${hidden} ${hidden === 1 ? 'línea más necesita' : 'líneas más necesitan'} atención.`} actionLabel="Ver canales" />
      ) : null}
    </div>
  )
}
