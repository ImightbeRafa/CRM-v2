'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { trackMetaEvent } from '@/app/components/MetaPixel';
import SimpleAuthModal from './SimpleAuthModal';

/** The landing's sections are server-rendered; these small islands only open the sign-in modal and run the nav. */
const OPEN_AUTH_EVENT = 'betsy:open-auth';

type AuthMode = 'signin' | 'signup';

export function openAuth(mode: AuthMode = 'signup') {
  window.dispatchEvent(new CustomEvent<AuthMode>(OPEN_AUTH_EVENT, { detail: mode }));
}

/** One modal for the whole page, plus the landing pageview for the Meta pixel. */
export function AuthHost() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('signup');
  useEffect(() => {
    trackMetaEvent('ViewContent', { content_name: 'Landing Page', content_category: 'Marketing' });
    const onOpen = (e: Event) => {
      setMode((e as CustomEvent<AuthMode>).detail === 'signin' ? 'signin' : 'signup');
      setOpen(true);
    };
    window.addEventListener(OPEN_AUTH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_AUTH_EVENT, onOpen);
  }, []);
  return <SimpleAuthModal isOpen={open} mode={mode} onClose={() => setOpen(false)} />;
}

export function OpenAuthButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => openAuth()} className={className}>
      {children}
    </button>
  );
}

const NAV = [
  { href: '#bandeja', label: 'Bandeja' },
  { href: '#operacion', label: 'Pedidos y envíos' },
  { href: '#agentes', label: 'Agentes de IA' },
  { href: '#precios', label: 'Precios' },
  { href: '#contacto', label: 'Contacto' },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || menuOpen ? 'border-b border-[#14131a]/10 bg-[#f6f4ef]/90 backdrop-blur-xl' : 'bg-transparent'
      }`}
    >
      <nav aria-label="Principal" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#inicio" className="font-[family-name:var(--font-logo)] text-[22px] font-bold tracking-tight text-[#14131a]">
          Betsy
        </a>
        <ul className="hidden items-center gap-7 lg:flex">
          {NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="text-[14px] font-medium text-[#14131a]/70 transition-colors hover:text-[#14131a]">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="hidden items-center gap-2 lg:flex">
          <button type="button" onClick={() => openAuth('signin')} className="rounded-full px-4 py-2 text-[14px] font-medium text-[#14131a]/80 hover:text-[#14131a]">
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => openAuth()}
            className="rounded-full bg-[#14131a] px-4 py-2 text-[14px] font-semibold text-white transition hover:bg-[#2a2833]"
          >
            Probar gratis
          </button>
        </div>
        <button
          type="button"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-[#14131a] lg:hidden"
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={menuOpen}
          aria-controls="home-mobile-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </nav>
      {menuOpen && (
        <div id="home-mobile-menu" className="border-t border-[#14131a]/10 px-4 pb-5 pt-2 lg:hidden">
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="block py-3 text-[16px] font-medium text-[#14131a]"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openAuth('signin');
              }}
              className="h-11 rounded-full border border-[#14131a]/15 text-[15px] font-medium text-[#14131a]"
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openAuth();
              }}
              className="h-11 rounded-full bg-[#14131a] text-[15px] font-semibold text-white"
            >
              Probar gratis
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
