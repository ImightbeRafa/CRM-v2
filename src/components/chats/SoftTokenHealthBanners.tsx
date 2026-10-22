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
 * Line health strip for /chats: one red banner per line with a real problem (token dead, webhook
 * gone, unlinked), reusing the same classification as Canales. A line that is only quiet (token and
 * subscription fine) gets one small grey note at most, never a red banner (Rafael 2026-10-22).
 * Renders outside the bucket / list / rail chrome.
 */
export function SoftTokenHealthBanners({ accounts }: Props) {
  const rows = accounts.map((account) => ({ account, health: lineHealth(account) }))
  const down = rows.filter(({ health }) => health.needsAction)
  const quiet = rows.filter(({ account, health }) => !health.needsAction && account.silentSince)
  if (down.length === 0 && quiet.length === 0) return null

  const visible = down.slice(0, MAX_VISIBLE)
  const hidden = down.length - visible.length

  return (
    <div data-testid="soft-token-health-banners">
      {visible.map(({ account, health }) => (
        <ChannelDownBanner
          key={account.id}
          message={
            account.webhookGoneSince
              ? `${accountDisplayLabel(account)} · Meta dejó de mandar los mensajes de esta línea a Betsy (desde ${formatSinceCr(new Date(account.webhookGoneSince))}).`
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
      {down.length === 0 && quiet.length > 0 ? (
        <p
          className="border-b border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[11.5px] text-slate-500"
          data-testid="soft-line-quiet-note"
        >
          {quiet.length === 1
            ? `${accountDisplayLabel(quiet[0].account)} no recibe mensajes desde ${formatSinceCr(new Date(quiet[0].account.silentSince as string))}. La línea está conectada; puede ser un día tranquilo.`
            : `${quiet.length} líneas sin mensajes hace rato. Están conectadas; puede ser un día tranquilo.`}
        </p>
      ) : null}
    </div>
  )
}
