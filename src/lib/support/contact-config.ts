/**
 * Public business contact info for /soporte (SPEC §8). Env is the source;
 * an unset var falls back to the default, an explicitly empty one hides the item.
 * Nothing here is secret. Pure (reads the env object it is given).
 */

export type SupportContactConfig = {
  whatsapp: { digits: string; display: string; url: string } | null
  instagram: { handle: string; display: string; url: string } | null
  emails: string[]
  hours: string | null
}

const DEFAULTS = {
  SUPPORT_PUBLIC_EMAILS: 'hola@betsycrm.com',
  SUPPORT_WHATSAPP: '50662470831',
  SUPPORT_INSTAGRAM: 'betsy_crm',
  SUPPORT_HOURS: '',
} as const

type EnvLike = Record<string, string | undefined>

function read(env: EnvLike, key: keyof typeof DEFAULTS): string {
  const raw = env[key]
  return (raw === undefined ? DEFAULTS[key] : raw).trim()
}

/** `50662470831` → `+506 6247-0831`; other lengths → `+<digits>`. */
export function formatWhatsappDisplay(digits: string): string {
  if (/^506\d{8}$/.test(digits)) return `+506 ${digits.slice(3, 7)}-${digits.slice(7)}`
  return `+${digits}`
}

export function getSupportContactConfig(env: EnvLike = process.env): SupportContactConfig {
  const wa = read(env, 'SUPPORT_WHATSAPP').replace(/\D/g, '')
  const ig = read(env, 'SUPPORT_INSTAGRAM').replace(/^@/, '')
  const emails = read(env, 'SUPPORT_PUBLIC_EMAILS')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e))
  const hours = read(env, 'SUPPORT_HOURS')
  return {
    whatsapp:
      wa.length >= 8 && wa.length <= 15
        ? { digits: wa, display: formatWhatsappDisplay(wa), url: `https://wa.me/${wa}` }
        : null,
    instagram: /^[A-Za-z0-9._]{1,30}$/.test(ig)
      ? { handle: ig, display: `@${ig}`, url: `https://www.instagram.com/${ig}/` }
      : null,
    emails,
    hours: hours ? hours.slice(0, 120) : null,
  }
}
