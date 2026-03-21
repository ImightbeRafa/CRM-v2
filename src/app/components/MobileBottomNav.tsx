'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  ShoppingCart,
  Factory,
  BarChart,
  Menu,
  Settings,
  MessageSquare,
  HelpCircle,
  LogOut,
  X,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { ThemeToggle } from './ThemeToggle';

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Inicio', icon: Home },
  { path: '/ventas', label: 'Ventas', icon: ShoppingCart },
  { path: '/produccion', label: 'Producción', icon: Factory },
  { path: '/estadisticas', label: 'Estadísticas', icon: BarChart },
] as const;

const MORE_ITEMS = [
  { path: '/config', label: 'Configuración', icon: Settings },
  { path: '/chats', label: 'Mensajes', icon: MessageSquare },
  { path: '/help', label: 'Ayuda', icon: HelpCircle },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path: string) =>
    pathname === path || (path !== '/dashboard' && pathname?.startsWith(path));

  const isMoreActive = MORE_ITEMS.some((item) => pathname?.startsWith(item.path));

  return (
    <>
      {/* "More" drawer overlay */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/40 z-[90] md:hidden"
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[95] bg-card rounded-t-2xl shadow-2xl md:hidden"
              style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>
              <nav className="px-4 py-2 space-y-1">
                {MORE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = pathname?.startsWith(item.path);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      prefetch={false}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors ${
                        active
                          ? 'bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/40 dark:to-purple-950/40 text-blue-600 dark:text-blue-400'
                          : 'text-muted-foreground hover:bg-muted active:bg-accent'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="font-medium text-[15px]">{item.label}</span>
                    </Link>
                  );
                })}
                <div className="border-t border-border my-1 mx-4" />
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-sm text-muted-foreground">Tema</span>
                  <ThemeToggle />
                </div>
                <div className="border-t border-border my-1 mx-4" />
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    signOut({ callbackUrl: '/auth/signin' });
                  }}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors text-red-600 hover:bg-red-50 dark:hover:bg-red-950 active:bg-red-100 dark:active:bg-red-900 w-full"
                >
                  <LogOut className="h-5 w-5" />
                  <span className="font-medium text-[15px]">Cerrar Sesión</span>
                </button>
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-[100] md:hidden bg-card/95 backdrop-blur-lg border-t border-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex items-stretch justify-around h-14">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                prefetch={false}
                className="relative flex flex-col items-center justify-center flex-1 min-w-0 gap-0.5 transition-colors"
              >
                {active && (
                  <motion.div
                    layoutId="bottomNavIndicator"
                    className="absolute -top-px left-3 right-3 h-[2.5px] rounded-b-full bg-gradient-to-r from-blue-500 to-purple-500"
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  />
                )}
                <Icon
                  className={`h-5 w-5 transition-colors ${
                    active ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
                  }`}
                />
                <span
                  className={`text-[10px] leading-tight font-medium transition-colors ${
                    active ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}

          {/* "More" button */}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="relative flex flex-col items-center justify-center flex-1 min-w-0 gap-0.5"
          >
            {isMoreActive && !moreOpen && (
              <motion.div
                layoutId="bottomNavIndicator"
                className="absolute -top-px left-3 right-3 h-[2.5px] rounded-b-full bg-gradient-to-r from-blue-500 to-purple-500"
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              />
            )}
            {moreOpen ? (
              <X className="h-5 w-5 text-blue-600" />
            ) : (
              <Menu
                className={`h-5 w-5 transition-colors ${
                  isMoreActive ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
                }`}
              />
            )}
            <span
              className={`text-[10px] leading-tight font-medium transition-colors ${
                moreOpen || isMoreActive ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
              }`}
            >
              Más
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
