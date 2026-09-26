import Link from 'next/link'

type ChannelDownBannerProps = {
  message: string
  /** Where "Reparar" goes. Defaults to the Canales hub. */
  href?: string
  actionLabel?: string
  className?: string
}

/** STATE-01 · "Error al enviar + canal caído" — red strip with a repair link. */
export function ChannelDownBanner({
  message,
  href = '/config/social',
  actionLabel = 'Reparar',
  className = '',
}: ChannelDownBannerProps) {
  return (
    <div
      role="status"
      data-testid="aurora-channel-down-banner"
      className={`flex items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-4 py-2 text-[12px] text-red-700 ${className}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="text-[13px]">
          ⓘ
        </span>
        <span className="truncate">{message}</span>
      </span>
      <Link href={href} className="shrink-0 font-semibold text-red-700 underline-offset-2 hover:underline">
        {actionLabel}
      </Link>
    </div>
  )
}
