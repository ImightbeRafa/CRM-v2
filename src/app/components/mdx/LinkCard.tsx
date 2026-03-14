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
      className="not-prose group my-3 flex items-center gap-4 rounded-lg border bg-white p-4 transition-all hover:border-blue-200 hover:shadow-md no-underline"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors text-sm m-0">
          {title}
        </p>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5 m-0">{description}</p>
        )}
      </div>
      <Icon className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-blue-600 transition-colors" />
    </a>
  );
}
