import type { ChannelLogoKey } from '@/lib/social-account-identity'

type ChannelLogoProps = {
  platform: string
  size?: number
  className?: string
  /** When true, use IG gradient (config cards only). Default mono. */
  colorful?: boolean
}

function logoKey(platform: string): ChannelLogoKey {
  return platform === 'instagram' ? 'instagram' : 'whatsapp'
}

/**
 * Official-style WA / IG glyphs as inline SVG (PR-3 §7.4).
 * Always accompany with a text name — never logo-only in product UI.
 */
export function ChannelLogo({ platform, size = 14, className, colorful }: ChannelLogoProps) {
  const key = logoKey(platform)
  const label = key === 'whatsapp' ? 'WhatsApp' : 'Instagram'

  if (key === 'whatsapp') {
    return (
      <svg
        role="img"
        aria-label={label}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill="#25D366"
          d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.89.52 3.66 1.43 5.19L2 22l5.05-1.52c1.48.81 3.17 1.27 4.99 1.27 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm0 18.12c-1.63 0-3.16-.44-4.47-1.21l-.32-.19-3 .91.9-2.92-.21-.34a8.1 8.1 0 0 1-1.24-4.46c0-4.48 3.65-8.13 8.14-8.13 4.48 0 8.13 3.65 8.13 8.13 0 4.49-3.65 8.13-8.13 8.13zm4.46-5.96c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.29.18-.53.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.11-.49.11-.11.24-.29.36-.43.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2 0 1.18.86 2.32.98 2.48.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.1.16 1.52.1.46-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28z"
        />
      </svg>
    )
  }

  if (colorful) {
    return (
      <svg
        role="img"
        aria-label={label}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="igGrad" cx="30%" cy="107%" r="150%">
            <stop offset="0%" stopColor="#fdf497" />
            <stop offset="5%" stopColor="#fdf497" />
            <stop offset="45%" stopColor="#fd5949" />
            <stop offset="60%" stopColor="#d6249f" />
            <stop offset="90%" stopColor="#285AEB" />
          </radialGradient>
        </defs>
        <path
          fill="url(#igGrad)"
          d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.69 21.31.27 16.95.07 15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4zm6.41-10.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44z"
        />
      </svg>
    )
  }

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#111827"
        d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.69 21.31.27 16.95.07 15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4zm6.41-10.85a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44z"
      />
    </svg>
  )
}
