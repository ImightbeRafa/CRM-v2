'use client';

import React from 'react';
import NavigationMenu from '@/app/components/ui/HomeButtom';
import { MobileBottomNav } from './MobileBottomNav';
import { ThemeToggle } from './ThemeToggle';

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
            <ThemeToggle />
          </div>
        </nav>
      )}

      <div className="pb-[72px] md:pb-0">
        {children}
      </div>

      <MobileBottomNav />
    </div>
  );
}
