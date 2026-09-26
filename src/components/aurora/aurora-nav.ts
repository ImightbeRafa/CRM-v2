import {
  Home,
  MessageSquare,
  Bot,
  Radio,
  Package,
  BarChart3,
  Settings,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'

export type AuroraNavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Only shown to owners / master (pages behind `view_config`). */
  adminOnly?: boolean
  /** Atajo: opens a Config tab; never highlighted (Configuración is). */
  shortcut?: true
}

export type AuroraNavSection = {
  title: string
  items: AuroraNavItem[]
}

export const AURORA_NAV: AuroraNavSection[] = [
  {
    title: 'Principal',
    items: [
      { href: '/dashboard', label: 'Inicio', icon: Home },
      { href: '/chats', label: 'Chats', icon: MessageSquare },
      { href: '/ventas', label: 'Pedidos', icon: Package },
      { href: '/estadisticas', label: 'Estadísticas', icon: BarChart3 },
    ],
  },
  {
    title: 'Atajos',
    items: [
      { href: '/config?tab=agentes', label: 'Agentes', icon: Bot, adminOnly: true, shortcut: true },
      { href: '/config?tab=social', label: 'Canales', icon: Radio, adminOnly: true, shortcut: true },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '/config', label: 'Configuración', icon: Settings, adminOnly: true },
      { href: '/help', label: 'Ayuda', icon: HelpCircle },
    ],
  },
]

/**
 * Longest-prefix match over real (non-shortcut) items. Anything under `/config`
 * (tabs, `/config/social`, `/config/ai-assistant`) highlights Configuración.
 */
export function getActiveAuroraHref(pathname: string | null): string | null {
  if (!pathname) return null
  const all = AURORA_NAV.flatMap((s) => s.items).filter((i) => !i.shortcut && !i.href.includes('?'))
  const match = all
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? null
}
