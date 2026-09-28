import Link from 'next/link'

type BetsyWordmarkProps = {
  /** `dark` for the dark brand panel, `light` (default) for cream/white surfaces. */
  tone?: 'light' | 'dark'
  className?: string
  /** Render as plain text (no link), e.g. inside a link already. */
  asText?: boolean
}

/** Gradient "Betsy" wordmark used on Aurora auth / onboarding / error screens. */
export function BetsyWordmark({ tone = 'light', className = '', asText = false }: BetsyWordmarkProps) {
  const gradient =
    tone === 'dark'
      ? 'from-[#A99BFF] to-au-tint-d6a8ff'
      : 'from-[#5B6CFF] to-[#8B5CF6]'
  const cls = `bg-gradient-to-r ${gradient} bg-clip-text text-[28px] font-bold leading-none tracking-tight text-transparent ${className}`
  if (asText) return <span className={cls}>Betsy</span>
  return (
    <Link href="/" className={cls} aria-label="Betsy CRM">
      Betsy
    </Link>
  )
}
