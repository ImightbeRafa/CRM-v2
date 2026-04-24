'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DocMeta } from '@/lib/docs';

interface DocsPaginationProps {
  docs: DocMeta[];
  currentSlug: string;
  basePath: string;
}

export function DocsPagination({ docs, currentSlug, basePath }: DocsPaginationProps) {
  const currentIndex = docs.findIndex(d => d.slug === currentSlug);
  if (currentIndex === -1) return null;

  const prev = currentIndex > 0 ? docs[currentIndex - 1] : null;
  const next = currentIndex < docs.length - 1 ? docs[currentIndex + 1] : null;

  if (!prev && !next) return null;

  return (
    <div className="not-prose mt-12 pt-6 border-t grid grid-cols-2 gap-4">
      {prev ? (
        <Link
          href={`${basePath}/${prev.slug}`}
          className="group flex flex-col items-start gap-1 p-4 rounded-lg border border-border bg-card hover:border-blue-300 hover:bg-blue-50/50 dark:hover:border-blue-800 dark:hover:bg-blue-950/20 transition-all"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-blue-600 transition-colors">
            <ChevronLeft className="h-3 w-3" />
            Anterior
          </span>
          <span className="text-sm font-medium text-muted-foreground group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
            {prev.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={`${basePath}/${next.slug}`}
          className="group flex flex-col items-end gap-1 p-4 rounded-lg border border-border bg-card hover:border-blue-300 hover:bg-blue-50/50 dark:hover:border-blue-800 dark:hover:bg-blue-950/20 transition-all"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-blue-600 transition-colors">
            Siguiente
            <ChevronRight className="h-3 w-3" />
          </span>
          <span className="text-sm font-medium text-muted-foreground group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
            {next.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}
