'use client';

import React from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';

interface LinkCardProps {
  href: string;
  title: string;
  description?: string;
  external?: boolean;
}

export function LinkCard({ href, title, description, external }: LinkCardProps) {
  const isExternal = external || href.startsWith('http');
  const Icon = isExternal ? ExternalLink : ArrowRight;

  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className="not-prose group my-3 flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-all hover:border-blue-300 hover:bg-accent/50 hover:shadow-md dark:hover:border-blue-800 no-underline"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors text-sm m-0">
          {title}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 m-0">{description}</p>
        )}
      </div>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors" />
    </a>
  );
}
