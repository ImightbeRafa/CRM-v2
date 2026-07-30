'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, Package, X } from 'lucide-react';
import { getLogisticsSectionLabel, LOGISTICS_NAV_ITEMS } from '../nav-items';

export function LogisticsMobileNav({ userEmail }: { userEmail?: string | null }) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const drawerTitleId = useId();
    const closeBtnRef = useRef<HTMLButtonElement>(null);
    const sectionLabel = getLogisticsSectionLabel(pathname);

    const isActive = (href: string) =>
        pathname === href || (href !== '/logistics' && !!pathname?.startsWith(href));

    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!open) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const t = window.setTimeout(() => closeBtnRef.current?.focus(), 50);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = prevOverflow;
            window.clearTimeout(t);
        };
    }, [open]);

    return (
        <div className="lm-mobile-nav">
            <div className="lm-mobile-nav-bar">
                <button
                    type="button"
                    className="lm-mobile-menu-btn"
                    onClick={() => setOpen(true)}
                    aria-expanded={open}
                    aria-controls="lm-mobile-drawer"
                    aria-label="Abrir menú de logística"
                >
                    <Menu size={18} />
                </button>

                <div className="lm-mobile-brand">
                    <div className="lm-mobile-brand-icon">
                        <Package size={15} color="white" />
                    </div>
                    <div className="lm-mobile-brand-text">
                        <p className="lm-mobile-brand-title">HolaMA</p>
                        <p className="lm-mobile-brand-section">{sectionLabel}</p>
                    </div>
                </div>

                <Link href="/dashboard" className="lm-mobile-exit" aria-label="Volver a Betsy">
                    <LogOut size={16} />
                </Link>
            </div>

            {open && (
                <>
                    <button
                        type="button"
                        className="lm-mobile-drawer-backdrop"
                        aria-label="Cerrar menú"
                        onClick={() => setOpen(false)}
                    />
                    <nav
                        id="lm-mobile-drawer"
                        className="lm-mobile-drawer"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={drawerTitleId}
                    >
                        <div className="lm-mobile-drawer-header">
                            <div>
                                <h2 id={drawerTitleId} className="lm-mobile-drawer-title">
                                    Menú Logistics
                                </h2>
                                {userEmail && (
                                    <p className="lm-mobile-drawer-email">{userEmail}</p>
                                )}
                            </div>
                            <button
                                ref={closeBtnRef}
                                type="button"
                                className="lm-mobile-menu-btn"
                                onClick={() => setOpen(false)}
                                aria-label="Cerrar menú"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="lm-mobile-drawer-links">
                            {LOGISTICS_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                                const active = isActive(href);
                                return (
                                    <Link
                                        key={href}
                                        href={href}
                                        className={`lm-mobile-drawer-link${active ? ' is-active' : ''}`}
                                        aria-current={active ? 'page' : undefined}
                                        onClick={() => setOpen(false)}
                                    >
                                        <Icon size={16} />
                                        <span>{label}</span>
                                    </Link>
                                );
                            })}
                        </div>

                        <Link
                            href="/dashboard"
                            className="lm-mobile-drawer-footer"
                            onClick={() => setOpen(false)}
                        >
                            <LogOut size={14} />
                            Volver a Betsy
                        </Link>
                    </nav>
                </>
            )}
        </div>
    );
}
