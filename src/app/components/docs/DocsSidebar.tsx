'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Clock } from 'lucide-react';
import type { DocMeta } from '@/lib/docs';
import {
  Rocket, Truck, Code, Settings, CreditCard, HelpCircle,
  ShoppingCart, Factory, BarChart3, Plug,
} from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  'getting-started': 'Primeros Pasos',
  'shipping': 'Envíos',
  'integraciones': 'Integraciones',
  'api': 'API',
  'general': 'General',
  'config': 'Configuración',
  'billing': 'Facturación',
  'ventas': 'Ventas',
  'produccion': 'Producción',
  'estadisticas': 'Estadísticas',
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'getting-started': Rocket,
  'shipping': Truck,
  'api': Code,
  'config': Settings,
  'billing': CreditCard,
  'general': HelpCircle,
  'ventas': ShoppingCart,
  'produccion': Factory,
  'estadisticas': BarChart3,
  'integraciones': Plug,
};

interface DocsSidebarProps {
  docs: DocMeta[];
  currentSlug?: string;
  basePath: string;
  onNavigate?: () => void;
}

export function DocsSidebar({ docs, currentSlug, basePath, onNavigate }: DocsSidebarProps) {
  const categories = Array.from(new Set(docs.map(d => d.category)));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCategory = (cat: string) => {
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <nav className="space-y-1">
      {categories.map(cat => {
        const catDocs = docs.filter(d => d.category === cat);
        if (catDocs.length === 0) return null;
        const Icon = CATEGORY_ICONS[cat] || HelpCircle;
        const isCollapsed = collapsed[cat] ?? false;
        const hasActive = catDocs.some(d => d.slug === currentSlug);

        return (
          <div key={cat}>
            <button
              onClick={() => toggleCategory(cat)}
              className={`
                w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg transition-colors
                ${hasActive ? 'text-blue-700 bg-blue-50/50' : 'text-muted-foreground hover:bg-muted'}
              `}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{CATEGORY_LABELS[cat] || cat}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
            </button>

            {!isCollapsed && (
              <div className="ml-3 pl-3 border-l border-border mt-1 mb-2 space-y-0.5">
                {catDocs.map(doc => {
                  const isActive = doc.slug === currentSlug;
                  return (
                    <Link
                      key={doc.slug}
                      href={`${basePath}/${doc.slug}`}
                      onClick={onNavigate}
                      className={`
                        flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors
                        ${isActive
                          ? 'bg-blue-50 text-blue-700 font-medium border-l-2 border-blue-600 -ml-[1px] pl-[11px]'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }
                      `}
                    >
                      <span className="truncate flex-1">{doc.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {doc.readingTime}m
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
