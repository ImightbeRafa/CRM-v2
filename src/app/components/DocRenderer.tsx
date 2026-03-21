'use client';

import React from 'react';
import { MDXRemote, MDXRemoteSerializeResult } from 'next-mdx-remote';
import { Clock } from 'lucide-react';
import { Callout } from './mdx/Callout';
import { Steps, Step } from './mdx/Steps';
import { LinkCard } from './mdx/LinkCard';

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

function getTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (typeof node === 'object' && 'props' in node) {
    return getTextContent((node as React.ReactElement).props.children);
  }
  return '';
}

const mdxComponents = {
  Callout,
  Steps,
  Step,
  LinkCard,
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const text = getTextContent(children);
    const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    return <h2 id={id} {...props}>{children}</h2>;
  },
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const text = getTextContent(children);
    const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    return <h3 id={id} {...props}>{children}</h3>;
  },
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-6 w-full overflow-x-auto rounded-lg border border-border">
      <table className="m-0 w-full text-sm" {...props}>{children}</table>
    </div>
  ),
  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-muted border-b border-border" {...props}>{children}</thead>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="px-4 py-2.5 text-muted-foreground border-t border-border" {...props}>{children}</td>
  ),
  tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr className="hover:bg-muted/50 transition-colors" {...props}>{children}</tr>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    if (className?.includes('language-')) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code className="px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[0.85em] font-mono border border-border" {...props}>
        {children}
      </code>
    );
  },
};

interface DocRendererProps {
  source: MDXRemoteSerializeResult;
  title: string;
  description?: string;
  category?: string;
  readingTime?: number;
}

export function DocRenderer({ source, title, description, category, readingTime }: DocRendererProps) {
  return (
    <article className="prose prose-slate max-w-none prose-headings:scroll-mt-24 prose-a:text-blue-600 prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-lg prose-pre:border-0 prose-code:before:hidden prose-code:after:hidden prose-img:rounded-lg prose-table:m-0 prose-thead:border-0 prose-tr:border-0 prose-th:p-0 prose-td:p-0">
      <div className="not-prose mb-8 pb-6 border-b">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {category && (
            <span className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {CATEGORY_LABELS[category] || category}
            </span>
          )}
          {readingTime && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {readingTime} min de lectura
            </span>
          )}
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-3 leading-tight">{title}</h1>
        {description && <p className="text-lg text-muted-foreground leading-relaxed">{description}</p>}
      </div>
      <MDXRemote {...source} components={mdxComponents} />
    </article>
  );
}
