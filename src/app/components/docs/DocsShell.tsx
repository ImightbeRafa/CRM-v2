'use client';

import React, { useState, useCallback } from 'react';
import { Menu, X } from 'lucide-react';
import type { DocMeta } from '@/lib/docs';
import { DocsSidebar } from './DocsSidebar';

interface DocsShellProps {
  docs: DocMeta[];
  currentSlug?: string;
  basePath: string;
  children: React.ReactNode;
  rightSidebar?: React.ReactNode;
  /**
   * Inside an Aurora shell (Ayuda): the shell owns the viewport, so columns scroll on their own
   * instead of sticking under the classic 57px header, and the FAB clears the mobile bottom nav.
   */
  embedded?: boolean;
}

export function DocsShell({ docs, currentSlug, basePath, children, rightSidebar, embedded = false }: DocsShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <div className={`flex min-h-0 flex-1 ${embedded ? 'overflow-hidden' : ''}`}>
      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeMobile} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-card text-card-foreground shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-semibold text-foreground text-sm">Navegación</span>
              <button onClick={closeMobile} className="p-1 rounded-md hover:bg-muted">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <div className="p-3">
              <DocsSidebar docs={docs} currentSlug={currentSlug} basePath={basePath} onNavigate={closeMobile} />
            </div>
          </div>
        </div>
      )}

      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className={`lg:hidden fixed ${embedded ? 'bottom-20' : 'bottom-4'} left-4 z-40 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition-colors`}
        aria-label="Abrir menú de navegación"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Desktop sidebar */}
      <aside className={`hidden lg:block w-64 shrink-0 border-r border-border bg-muted/35 overflow-y-auto ${embedded ? '' : 'sticky top-[57px] h-[calc(100vh-57px)]'}`}>
        <div className="p-4">
          <DocsSidebar docs={docs} currentSlug={currentSlug} basePath={basePath} />
        </div>
      </aside>

      {/* Main content */}
      <main className={`flex-1 min-w-0 bg-background ${embedded ? 'overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-10' : 'px-6 py-8 lg:px-10'}`}>
        <div className="max-w-3xl mx-auto">
          {children}
        </div>
      </main>

      {/* Right sidebar (ToC) */}
      {rightSidebar && (
        <aside className={`hidden xl:block w-56 shrink-0 overflow-y-auto ${embedded ? '' : 'sticky top-[57px] h-[calc(100vh-57px)]'}`}>
          <div className="p-4 pt-8">
            {rightSidebar}
          </div>
        </aside>
      )}
    </div>
  );
}
