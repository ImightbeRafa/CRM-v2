import {
  Building2,
  Database,
  ListChecks,
  Package,
  UserCheck,
  Radio,
  Bot,
  Plug,
  Truck,
  FileSpreadsheet,
  Trash2,
  Users,
  CreditCard,
  Shield,
  type LucideIcon,
} from 'lucide-react'

/** Sections rendered inside `/config?tab=<id>` (existing tab content components). */
export type ConfigTabId =
  | 'profile'
  | 'fields'
  | 'statuses'
  | 'inventory'
  | 'clients'
  | 'shipping-config'
  | 'users'
  | 'import'
  | 'billing'
  | 'bulk-delete'
  | 'audit'

export type ConfigNavItem = {
  key: string
  label: string
  icon: LucideIcon
  /** Exactly one of `tab` / `href` is set. */
  tab?: ConfigTabId
  href?: string
}

export type ConfigNavGroup = {
  title: string
  items: ConfigNavItem[]
}

export const CONFIG_HUB_TAB = 'hub'

/**
 * Owner-facing Config navigation (CFG-01). The staff Betsy AI Assistant
 * (`/config/ai-assistant`) is intentionally NOT listed: the route stays for ops
 * but owners never see it in nav or hub.
 */
export const CONFIG_NAV: ConfigNavGroup[] = [
  {
    title: 'Negocio',
    items: [
      { key: 'profile', label: 'General', icon: Building2, tab: 'profile' },
      { key: 'inventory', label: 'Productos e inventario', icon: Package, tab: 'inventory' },
      { key: 'fields', label: 'Campos de pedido', icon: Database, tab: 'fields' },
      { key: 'statuses', label: 'Estados de pedidos', icon: ListChecks, tab: 'statuses' },
      { key: 'clients', label: 'Clientes', icon: UserCheck, tab: 'clients' },
    ],
  },
  {
    title: 'Comunicación',
    items: [
      { key: 'canales', label: 'Cuentas conectadas', icon: Radio, href: '/config/social' },
      { key: 'agentes', label: 'Agentes IA', icon: Bot, href: '/config/agentes' },
      { key: 'integrations', label: 'Integraciones API', icon: Plug, href: '/config/integrations' },
    ],
  },
  {
    title: 'Operación',
    items: [
      { key: 'shipping-config', label: 'Envíos · Correos CR', icon: Truck, tab: 'shipping-config' },
      { key: 'import', label: 'Importar Excel', icon: FileSpreadsheet, tab: 'import' },
      { key: 'bulk-delete', label: 'Eliminación masiva', icon: Trash2, tab: 'bulk-delete' },
    ],
  },
  {
    title: 'Cuenta',
    items: [
      { key: 'users', label: 'Equipo y roles', icon: Users, tab: 'users' },
      { key: 'billing', label: 'Plan y facturación', icon: CreditCard, tab: 'billing' },
      { key: 'audit', label: 'Auditoría', icon: Shield, tab: 'audit' },
    ],
  },
]

export const CONFIG_TAB_IDS: readonly ConfigTabId[] = CONFIG_NAV.flatMap((g) => g.items)
  .map((i) => i.tab)
  .filter((t): t is ConfigTabId => Boolean(t))

/** tab id -> label, for the page header subtitle. */
export const CONFIG_NAV_LABELS: Record<string, string> = Object.fromEntries(
  CONFIG_NAV.flatMap((g) => g.items).filter((i) => i.tab).map((i) => [i.tab as string, i.label]),
)

/** Old `/config?tab=` ids that were pass-through cards; now real routes. */
export const LEGACY_TAB_REDIRECTS: Record<string, string> = {
  social: '/config/social',
  agentes: '/config/agentes',
  integrations: '/config/integrations',
  // Staff assistant is not an owner surface; land on the hub instead of the ops page.
  'ai-assistant': '/config',
}

export function resolveConfigTab(param: string | null | undefined): ConfigTabId | typeof CONFIG_HUB_TAB {
  if (param && (CONFIG_TAB_IDS as readonly string[]).includes(param)) return param as ConfigTabId
  return CONFIG_HUB_TAB
}

export function configTabHref(tab: ConfigTabId | typeof CONFIG_HUB_TAB): string {
  return tab === CONFIG_HUB_TAB ? '/config' : `/config?tab=${encodeURIComponent(tab)}`
}
