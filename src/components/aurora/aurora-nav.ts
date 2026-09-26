import {
  Home,
  MessageSquare,
  Bot,
  Radio,
  BookOpen,
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
  /** Static badge; numeric badges are only added when a real count exists. */
  badge?: 'Pronto'
  /** Only shown to owners / master (pages behind `view_config`). */
  adminOnly?: boolean
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
      { href: '/config/agentes', label: 'Agentes', icon: Bot, adminOnly: true },
      { href: '/config/social', label: 'Canales', icon: Radio, adminOnly: true },
      {
        href: '/config/agentes/conocimiento',
        label: 'Conocimiento',
        icon: BookOpen,
        badge: 'Pronto',
        adminOnly: true,
      },
      { href: '/ventas', label: 'Pedidos', icon: Package },
      { href: '/estadisticas', label: 'Estadísticas', icon: BarChart3, badge: 'Pronto' },
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
 * Longest-prefix match so `/config/agentes/conocimiento` highlights Conocimiento
 * and not Agentes / Configuración.
 */
export function getActiveAuroraHref(pathname: string | null): string | null {
  if (!pathname) return null
  const all = AURORA_NAV.flatMap((s) => s.items)
  const match = all
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? null
}
