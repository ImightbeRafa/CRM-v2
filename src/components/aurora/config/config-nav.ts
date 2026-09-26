import {
  LayoutGrid,
  Globe,
  Package,
  ListFilter,
  ListChecks,
  Users,
  Radio,
  Bot,
  Link2,
  Truck,
  Upload,
  Trash2,
  UsersRound,
  CreditCard,
  History,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/lib/rbac'

/**
 * Sections rendered inside `/config?tab=<id>`. Live slugs are canonical; Figma's Spanish
 * slugs (general, cuentas, equipo…) are accepted only as inbound aliases.
 */
export type ConfigTabId =
  | 'profile'
  | 'inventory'
  | 'fields'
  | 'statuses'
  | 'clients'
  | 'social'
  | 'agentes'
  | 'integrations'
  | 'shipping-config'
  | 'import'
  | 'bulk-delete'
  | 'users'
  | 'billing'
  | 'audit'

export type ConfigNavItem = {
  key: ConfigTabId
  tab: ConfigTabId
  label: string
  icon: LucideIcon
  /** Inbound aliases (lowercase, no accents) that redirect to the canonical tab. */
  aliases: string[]
  figmaNode: string
  /** Sub-nav hides the item when the session lacks this permission. */
  permission?: Permission
}

export type ConfigNavGroup = {
  title: string
  items: ConfigNavItem[]
}

export const CONFIG_HUB_TAB = 'hub'

export const CONFIG_HUB = {
  label: 'Resumen',
  icon: LayoutGrid,
  aliases: ['hub', 'resumen'],
  figmaNode: '190:1246',
}

/**
 * Owner-facing Config navigation (Figma ROUTE-01). The staff assistant
 * (`/config/ai-assistant`) is intentionally NOT listed.
 */
export const CONFIG_NAV: ConfigNavGroup[] = [
  {
    title: 'Negocio',
    items: [
      { key: 'profile', tab: 'profile', label: 'General', icon: Globe, aliases: ['general'], figmaNode: '190:1682' },
      { key: 'inventory', tab: 'inventory', label: 'Productos', icon: Package, aliases: ['productos'], figmaNode: '190:2101' },
      { key: 'fields', tab: 'fields', label: 'Campos', icon: ListFilter, aliases: ['campos'], figmaNode: '190:2625' },
      { key: 'statuses', tab: 'statuses', label: 'Estados', icon: ListChecks, aliases: ['estados'], figmaNode: '191:1853' },
      { key: 'clients', tab: 'clients', label: 'Clientes', icon: Users, aliases: ['clientes'], figmaNode: '191:2358' },
    ],
  },
  {
    title: 'Comunicación',
    items: [
      {
        key: 'social',
        tab: 'social',
        label: 'Cuentas conectadas',
        icon: Radio,
        aliases: ['cuentas', 'canales'],
        figmaNode: '191:2900',
        permission: 'update_config',
      },
      { key: 'agentes', tab: 'agentes', label: 'Agentes IA', icon: Bot, aliases: [], figmaNode: '191:3475' },
      {
        key: 'integrations',
        tab: 'integrations',
        label: 'Integraciones API',
        icon: Link2,
        aliases: ['integraciones'],
        figmaNode: '192:3080',
      },
    ],
  },
  {
    title: 'Operación',
    items: [
      {
        key: 'shipping-config',
        tab: 'shipping-config',
        label: 'Envíos',
        icon: Truck,
        aliases: ['envios', 'shipping'],
        figmaNode: '192:3529',
      },
      { key: 'import', tab: 'import', label: 'Importar', icon: Upload, aliases: ['importar'], figmaNode: '192:3929' },
      {
        key: 'bulk-delete',
        tab: 'bulk-delete',
        label: 'Eliminación masiva',
        icon: Trash2,
        aliases: ['eliminacion'],
        figmaNode: '193:3128',
      },
    ],
  },
  {
    title: 'Cuenta',
    items: [
      { key: 'users', tab: 'users', label: 'Equipo', icon: UsersRound, aliases: ['equipo'], figmaNode: '193:3470' },
      { key: 'billing', tab: 'billing', label: 'Plan', icon: CreditCard, aliases: ['plan'], figmaNode: '193:3956' },
      { key: 'audit', tab: 'audit', label: 'Auditoría', icon: History, aliases: ['auditoria'], figmaNode: '193:4344' },
    ],
  },
]

export const CONFIG_TAB_IDS: readonly ConfigTabId[] = CONFIG_NAV.flatMap((g) => g.items).map((i) => i.tab)

/** tab id -> label (breadcrumb, section select). */
export const CONFIG_NAV_LABELS: Record<string, string> = Object.fromEntries(
  CONFIG_NAV.flatMap((g) => g.items).map((i) => [i.tab, i.label]),
)

/** Staff-only surfaces that must never resolve to an owner tab (land on the hub, as before). */
export const STAFF_ONLY_TABS: readonly string[] = ['ai-assistant']

function fold(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
}

/** Spanish + hub aliases -> canonical tab (keys folded: lowercase, no accents). */
export const CONFIG_TAB_ALIASES: Record<string, ConfigTabId | typeof CONFIG_HUB_TAB> = (() => {
  const map: Record<string, ConfigTabId | typeof CONFIG_HUB_TAB> = {}
  for (const alias of CONFIG_HUB.aliases) map[alias] = CONFIG_HUB_TAB
  for (const item of CONFIG_NAV.flatMap((g) => g.items)) {
    for (const alias of item.aliases) map[alias] = item.tab
  }
  return map
})()

/** Canonical tab (or hub) for any inbound `?tab=` value. Unknown / staff-only -> hub. */
export function normalizeTabParam(raw: string | null | undefined): ConfigTabId | typeof CONFIG_HUB_TAB {
  if (!raw) return CONFIG_HUB_TAB
  const value = raw.trim()
  if ((CONFIG_TAB_IDS as readonly string[]).includes(value)) return value as ConfigTabId
  const folded = fold(value)
  if (STAFF_ONLY_TABS.includes(folded)) return CONFIG_HUB_TAB
  if ((CONFIG_TAB_IDS as readonly string[]).includes(folded)) return folded as ConfigTabId
  return CONFIG_TAB_ALIASES[folded] ?? CONFIG_HUB_TAB
}

export const resolveConfigTab = normalizeTabParam

export function configTabHref(
  tab: ConfigTabId | typeof CONFIG_HUB_TAB,
  extra?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams()
  if (tab !== CONFIG_HUB_TAB) params.set('tab', tab)
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== undefined && k !== 'tab') params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `/config?${qs}` : '/config'
}

function toParams(search: URLSearchParams | string): URLSearchParams {
  if (typeof search !== 'string') return new URLSearchParams(search)
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

/**
 * Canonical `/config` URL for a query string. `changed` is true when the given `tab`
 * (or its absence) is not already canonical, so callers redirect exactly once.
 * Every other param is kept in its original order. Idempotent.
 */
export function normalizeConfigSearch(search: URLSearchParams | string): { href: string; changed: boolean } {
  const sp = toParams(search)
  const rawTab = sp.get('tab')
  const canonical = normalizeTabParam(rawTab)
  const rest = new URLSearchParams()
  sp.forEach((value, key) => {
    if (key !== 'tab') rest.append(key, value)
  })
  const params = new URLSearchParams()
  if (canonical !== CONFIG_HUB_TAB) params.set('tab', canonical)
  rest.forEach((value, key) => params.append(key, value))
  const qs = params.toString()
  const href = qs ? `/config?${qs}` : '/config'
  const changed = rawTab !== null && rawTab !== (canonical === CONFIG_HUB_TAB ? null : canonical)
  return { href, changed }
}

/** `/config/<segments>` (any depth) -> canonical `/config` URL, keeping the query. */
export function configPathAliasToHref(segments: string[], search: URLSearchParams | string = ''): string {
  let first = segments[0] ?? ''
  try {
    first = decodeURIComponent(first)
  } catch {
    /* keep the raw segment */
  }
  first = fold(first)
  const tab = normalizeTabParam(first)
  const sp = toParams(search)
  sp.delete('tab')
  const extra: Record<string, string> = {}
  sp.forEach((v, k) => {
    extra[k] = v
  })
  return configTabHref(tab, extra)
}
