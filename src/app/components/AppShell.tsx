'use client';

import React from 'react';
import NavigationMenu from '@/app/components/ui/HomeButtom';
import { MobileBottomNav } from './MobileBottomNav';
import { ThemeToggle } from './ThemeToggle';
import { MessageCircleQuestion } from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  showNav?: boolean;
  className?: string;
}

export function AppShell({ children, showNav = true, className = '' }: AppShellProps) {
  return (
    <div className={`min-h-screen bg-background ${className}`}>
      {showNav && (
        <nav className="bg-card shadow-sm border-b border-border sticky top-0 z-10 hidden md:block">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <NavigationMenu />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event('betsy:open-feedback'))}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Enviar comentarios"
              >
                <MessageCircleQuestion className="h-4 w-4" />
                Comentarios
              </button>
              <ThemeToggle />
            </div>
          </div>
        </nav>
      )}

      <div className="app-shell-content md:pb-0">
        {children}
      </div>

      <MobileBottomNav />
    </div>
  );
}
