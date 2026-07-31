import {
    LayoutDashboard,
    Layers,
    Settings,
    BookOpen,
    PackageCheck,
    BarChart2,
    FileText,
    Shield,
    Users,
    Truck,
    type LucideIcon,
} from 'lucide-react';

export type LogisticsNavItem = {
    href: string;
    label: string;
    icon: LucideIcon;
};

export const LOGISTICS_NAV_ITEMS: LogisticsNavItem[] = [
    { href: '/logistics', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/logistics/carriers', label: 'Tablero de Envíos', icon: Layers },
    { href: '/logistics/mensajeria-privada', label: 'Mensajería Privada', icon: Truck },
    { href: '/logistics/retiros', label: 'Retiros', icon: PackageCheck },
    { href: '/logistics/config', label: 'Costos y Tarifas', icon: Settings },
    { href: '/logistics/accounting', label: 'Contabilidad', icon: BookOpen },
    { href: '/logistics/workforce', label: 'Personal', icon: Users },
    { href: '/logistics/reports', label: 'Reportes', icon: BarChart2 },
    { href: '/logistics/guias', label: 'Guías', icon: FileText },
    { href: '/logistics/admin', label: 'Admin', icon: Shield },
];

export function getLogisticsSectionLabel(pathname: string | null): string {
    if (!pathname) return 'Logistics';
    const exact = LOGISTICS_NAV_ITEMS.find((item) => item.href === pathname);
    if (exact) return exact.label;
    const nested = LOGISTICS_NAV_ITEMS
        .filter((item) => item.href !== '/logistics' && pathname.startsWith(item.href))
        .sort((a, b) => b.href.length - a.href.length)[0];
    return nested?.label ?? 'Logistics';
}
