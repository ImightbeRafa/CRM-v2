'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

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

interface DocsBreadcrumbProps {
  basePath: string;
  baseLabel: string;
  category?: string;
  title?: string;
}

export function DocsBreadcrumb({ basePath, baseLabel, category, title }: DocsBreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6 flex-wrap">
      <Link href={basePath} className="flex items-center gap-1 hover:text-blue-600 transition-colors">
        <Home className="h-3 w-3" />
        {baseLabel}
      </Link>
      {category && (
        <>
          <ChevronRight className="h-3 w-3" />
          <span className="text-muted-foreground">{CATEGORY_LABELS[category] || category}</span>
        </>
      )}
      {title && (
        <>
          <ChevronRight className="h-3 w-3" />
          <span className="text-muted-foreground font-medium truncate max-w-[200px]">{title}</span>
        </>
      )}
    </nav>
  );
}
