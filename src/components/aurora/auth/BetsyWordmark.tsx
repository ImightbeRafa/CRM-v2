import { BetsyLogo } from '@/components/brand/BetsyLogo'

type BetsyWordmarkProps = {
  /** `dark` for the dark brand panel, `light` (default) for cream/white surfaces. */
  tone?: 'light' | 'dark'
  className?: string
  /** Render as plain text (no link), e.g. inside a link already. */
  asText?: boolean
}

/** Auth / onboarding / error screens: the shared Betsy wordmark (see `@/components/brand/BetsyLogo`). */
export function BetsyWordmark({ tone = 'light', className = '', asText = false }: BetsyWordmarkProps) {
  return (
    <BetsyLogo
      tone={tone}
      size={28}
      className={className}
      href={asText ? undefined : '/'}
      ariaLabel={asText ? undefined : 'Betsy CRM'}
    />
  )
}
