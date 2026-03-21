'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { DocHeading } from '@/lib/docs';

interface TableOfContentsProps {
  headings: DocHeading[];
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const elements = headings
      .map(h => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[];

    if (elements.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );

    elements.forEach(el => observerRef.current?.observe(el));

    return () => observerRef.current?.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      setActiveId(id);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        En esta página
      </p>
      <nav className="space-y-0.5">
        {headings.map(heading => {
          const isActive = activeId === heading.id;
          return (
            <button
              key={heading.id}
              onClick={() => handleClick(heading.id)}
              className={`
                block w-full text-left text-xs py-1 transition-colors border-l-2
                ${heading.depth === 3 ? 'pl-5' : 'pl-3'}
                ${isActive
                  ? 'border-blue-600 text-blue-700 font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }
              `}
            >
              {heading.text}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
