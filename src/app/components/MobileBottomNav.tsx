'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
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

function roleLabel(session: ReturnType<typeof useSession>['data']): string | null {
  if (!session?.user) return null;
  if (session.user.role === 'MASTER') return 'Master';
  const membership = session.user.currentTenant?.role;
  if (membership) return String(membership);
  return null;
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const drawerTitleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const isActive = (path: string) =>
    pathname === path || (path !== '/dashboard' && pathname?.startsWith(path));

  const isMoreActive = MORE_ITEMS.some((item) => pathname?.startsWith(item.path));
  const role = roleLabel(session);

  useEffect(() => {
    if (!moreOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    // Defer focus so the drawer is in the DOM
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(t);
    };
  }, [moreOpen]);

  return (
    <>
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
              aria-hidden="true"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={drawerTitleId}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[95] bg-card rounded-t-2xl shadow-2xl md:hidden max-h-[85dvh] overflow-y-auto"
              style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>

              <div className="flex items-center justify-between px-5 pb-2">
                <h2 id={drawerTitleId} className="text-base font-semibold text-foreground">
                  Menú y cuenta
                </h2>
                <button
                  ref={closeBtnRef}
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="inline-flex items-center justify-center h-11 w-11 rounded-lg hover:bg-muted transition-colors"
                  aria-label="Cerrar menú"
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              {session?.user && (
                <div className="mx-4 mb-3 rounded-xl bg-muted/60 border border-border px-4 py-3">
                  <p className="text-sm font-medium text-foreground break-all">
                    {session.user.email}
                  </p>
                  {role && (
                    <p className="text-xs text-muted-foreground mt-1">{role}</p>
                  )}
                </div>
              )}

              <nav className="px-4 py-1 space-y-1">
                {MORE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = pathname?.startsWith(item.path);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      prefetch={false}
                      onClick={() => setMoreOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors min-h-[44px] ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                          : 'text-muted-foreground hover:bg-muted active:bg-accent'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="font-medium text-[15px]">{item.label}</span>
                    </Link>
                  );
                })}
                <div className="border-t border-border my-1 mx-4" />
                <div className="flex items-center justify-between px-4 py-2 min-h-[44px]">
                  <span className="text-sm text-muted-foreground">Tema</span>
                  <ThemeToggle />
                </div>
                <div className="border-t border-border my-1 mx-4" />
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    signOut({ callbackUrl: '/auth/signin' });
                  }}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors text-red-600 hover:bg-red-50 dark:hover:bg-red-950 active:bg-red-100 dark:active:bg-red-900 w-full min-h-[48px]"
                >
                  <LogOut className="h-5 w-5" />
                  <span className="font-medium text-[15px]">Cerrar Sesión</span>
                </button>
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav
        className="fixed bottom-0 left-0 right-0 z-[100] md:hidden bg-card/95 backdrop-blur-lg border-t border-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Navegación principal"
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
                    className="absolute -top-px left-3 right-3 h-[2.5px] rounded-b-full bg-blue-500"
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  />
                )}
                <Icon
                  className={`h-5 w-5 transition-colors ${
                    active ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
                  }`}
                />
                <span
                  className={`text-[10px] leading-tight font-medium transition-colors truncate max-w-full px-0.5 ${
                    active ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="relative flex flex-col items-center justify-center flex-1 min-w-0 gap-0.5"
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-label={moreOpen ? 'Cerrar menú' : 'Abrir menú Más'}
          >
            {isMoreActive && !moreOpen && (
              <motion.div
                layoutId="bottomNavIndicator"
                className="absolute -top-px left-3 right-3 h-[2.5px] rounded-b-full bg-blue-500"
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
