import type { LucideIcon } from 'lucide-react'
import type { AuroraNavSection } from '@/components/aurora/aurora-nav'
import type { ConfigNavGroup } from '@/components/aurora/config/config-nav'

/** ⌘K palette entries. Only real destinations: no client / chat / order results are invented. */
export interface PaletteItem {
  id: string
  kind: 'nav' | 'config' | 'create' | 'search'
  label: string
  href: string
  hint?: string
  icon?: LucideIcon
}

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function buildPaletteItems(input: {
  nav: AuroraNavSection[]
  configNav: ConfigNavGroup[]
  isAdmin: boolean
  canViewSales: boolean
  canCreateSales: boolean
  canViewConfig: boolean
}): PaletteItem[] {
  const items: PaletteItem[] = []
  if (input.canCreateSales) {
    items.push({ id: 'create-order', kind: 'create', label: 'Crear pedido', href: '/ventas?nuevo=1' })
  }
  const seen = new Set<string>()
  for (const section of input.nav) {
    for (const item of section.items) {
      if (item.adminOnly && !input.isAdmin) continue
      if (seen.has(item.href)) continue
      seen.add(item.href)
      items.push({ id: `nav:${item.href}`, kind: 'nav', label: item.label, href: item.href, icon: item.icon })
    }
  }
  if (input.isAdmin && input.canViewConfig) {
    for (const group of input.configNav) {
      for (const item of group.items) {
        const href = `/config?tab=${item.tab}`
        if (seen.has(href)) continue
        items.push({
          id: `config:${item.tab}`,
          kind: 'config',
          label: item.label,
          href,
          hint: 'Configuración',
          icon: item.icon,
        })
      }
    }
  }
  return items
}

export function filterPaletteItems(items: PaletteItem[], query: string, canViewSales: boolean): PaletteItem[] {
  const q = query.trim()
  if (!q) return items
  const needle = norm(q)
  const matches = items.filter((i) => norm(i.label).includes(needle) || norm(i.hint ?? '').includes(needle))
  if (!canViewSales) return matches
  return [
    {
      id: 'search-orders',
      kind: 'search',
      label: `Buscar pedidos: “${q}”`,
      href: `/ventas?buscar=${encodeURIComponent(q)}`,
    },
    ...matches,
  ]
}
