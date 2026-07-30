import { redirect } from 'next/navigation';
import { requireLogisticsAdmin } from '@/lib/logistics-auth';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
    LogOut,
    Package,
} from 'lucide-react';
import { LOGISTICS_NAV_ITEMS } from './nav-items';
import { LogisticsMobileNav } from './components/LogisticsMobileNav';

export const metadata: Metadata = {
    title: 'HolaMA · Logistics Manager',
    icons: {
        icon: '/favicon-logistics.svg',
    },
};

export default async function LogisticsLayout({ children }: { children: React.ReactNode }) {
    const session = await requireLogisticsAdmin();
    if (!session) redirect('/dashboard');

    return (
        <div className="lm-root" style={{
            display: 'flex',
            minHeight: '100vh',
            background: '#0D0D0D',
            position: 'relative',
            overflow: 'hidden',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}>
            {/* ── Ambient orbs ─────────────────────────────── */}
            <div className="lm-orbs" style={{
                position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
            }}>
                <div style={{
                    position: 'absolute', top: '-15%', right: '-10%',
                    width: 600, height: 600, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)',
                    filter: 'blur(60px)',
                }} />
                <div style={{
                    position: 'absolute', bottom: '-15%', left: '-5%',
                    width: 700, height: 700, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(108,63,255,0.16) 0%, transparent 70%)',
                    filter: 'blur(80px)',
                }} />
                <div style={{
                    position: 'absolute', top: '45%', left: '35%',
                    width: 400, height: 400, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(139,87,246,0.08) 0%, transparent 70%)',
                    filter: 'blur(60px)',
                }} />
            </div>

            <LogisticsMobileNav userEmail={session.user?.email} />

            {/* ── Sidebar (hidden on mobile) ─────────────────── */}
            <aside className="lm-sidebar" style={{
                width: 232,
                minHeight: '100vh',
                flexShrink: 0,
                position: 'relative',
                zIndex: 10,
                background: 'rgba(255,255,255,0.035)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderRight: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                flexDirection: 'column',
                padding: '24px 0',
            }}>
                <div style={{ padding: '0 20px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'linear-gradient(135deg, #6c3fff, #3b82f6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 0 18px rgba(108,63,255,0.4)',
                        }}>
                            <Package size={19} color="white" />
                        </div>
                        <div>
                            <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 14, margin: 0 }}>HolaMA</p>
                            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0 }}>Logistics Manager</p>
                        </div>
                    </div>
                </div>

                <nav style={{ flex: 1, padding: '14px 12px' }}>
                    {LOGISTICS_NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                        <Link key={href} href={href} className="lm-nav-link" style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 12px', borderRadius: 9,
                            color: 'rgba(255,255,255,0.5)', textDecoration: 'none',
                            fontSize: 13.5, fontWeight: 500, marginBottom: 3,
                            transition: 'all 0.18s ease', border: '1px solid transparent',
                        }}>
                            <Icon size={15} />
                            {label}
                        </Link>
                    ))}
                </nav>

                <div style={{ padding: '14px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <Link href="/dashboard" style={{
                        display: 'flex', alignItems: 'center', gap: 9,
                        padding: '8px 12px', borderRadius: 9,
                        color: 'rgba(255,255,255,0.3)', textDecoration: 'none', fontSize: 12.5,
                        transition: 'color 0.15s',
                    }}>
                        <LogOut size={13} />
                        Volver a Betsy
                    </Link>
                    <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, padding: '6px 12px 0', margin: 0 }}>
                        {session.user?.email}
                    </p>
                </div>
            </aside>

            {/* ── Main content ─────────────────────────────── */}
            <main className="lm-main" style={{
                flex: 1, padding: '32px 36px',
                overflowY: 'auto', overflowX: 'auto',
                position: 'relative', zIndex: 1,
            }}>
                {children}
            </main>

            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                * { box-sizing: border-box; }
                body { margin: 0; }
                .lm-nav-link:hover {
                    background: rgba(255,255,255,0.07) !important;
                    color: #F2F2F2 !important;
                    border-color: rgba(255,255,255,0.1) !important;
                }
                .lm-glass {
                    background: rgba(255,255,255,0.05);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 14px;
                }
                .lm-glass-hi {
                    background: rgba(255,255,255,0.08);
                    backdrop-filter: blur(24px);
                    -webkit-backdrop-filter: blur(24px);
                    border: 1px solid rgba(255,255,255,0.15);
                    border-radius: 14px;
                }
                input, select, textarea {
                    color-scheme: dark;
                }
                input::placeholder { color: rgba(255,255,255,0.25); }
                select option { background: #1a1a2e; color: #F2F2F2; }
                ::-webkit-scrollbar { width: 4px; height: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes pulse-orb { 0%,100%{opacity:1} 50%{opacity:0.7} }

                .lm-mobile-nav { display: none; }
                .lm-stat-grid { grid-template-columns: repeat(6, 1fr); }

                .lm-mobile-nav-bar {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }
                .lm-mobile-menu-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    border: 1px solid rgba(255,255,255,0.1);
                    background: rgba(255,255,255,0.05);
                    color: #F2F2F2;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    flex-shrink: 0;
                }
                .lm-mobile-brand {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-width: 0;
                    flex: 1;
                }
                .lm-mobile-brand-icon {
                    width: 28px;
                    height: 28px;
                    border-radius: 8px;
                    background: linear-gradient(135deg, #6c3fff, #3b82f6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .lm-mobile-brand-text { min-width: 0; }
                .lm-mobile-brand-title {
                    color: #F2F2F2;
                    font-weight: 700;
                    font-size: 13px;
                    margin: 0;
                    line-height: 1.2;
                }
                .lm-mobile-brand-section {
                    color: rgba(255,255,255,0.45);
                    font-size: 11px;
                    margin: 1px 0 0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .lm-mobile-exit {
                    color: rgba(255,255,255,0.45);
                    text-decoration: none;
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .lm-mobile-drawer-backdrop {
                    position: fixed;
                    inset: 0;
                    z-index: 40;
                    border: none;
                    padding: 0;
                    margin: 0;
                    background: rgba(0,0,0,0.55);
                    cursor: pointer;
                }
                .lm-mobile-drawer {
                    position: fixed;
                    top: 0;
                    left: 0;
                    bottom: 0;
                    width: min(86vw, 320px);
                    z-index: 50;
                    background: #121218;
                    border-right: 1px solid rgba(255,255,255,0.1);
                    display: flex;
                    flex-direction: column;
                    padding: 14px 12px calc(16px + env(safe-area-inset-bottom, 0px));
                    box-shadow: 18px 0 40px rgba(0,0,0,0.35);
                    overflow: hidden;
                }
                .lm-mobile-drawer-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 10px;
                    padding: 4px 4px 14px;
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                }
                .lm-mobile-drawer-title {
                    color: #F2F2F2;
                    font-size: 15px;
                    font-weight: 700;
                    margin: 0;
                }
                .lm-mobile-drawer-email {
                    color: rgba(255,255,255,0.35);
                    font-size: 11px;
                    margin: 4px 0 0;
                    word-break: break-all;
                }
                .lm-mobile-drawer-links {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px 0;
                    min-height: 0;
                    -webkit-overflow-scrolling: touch;
                }
                .lm-mobile-drawer-link {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 11px 12px;
                    border-radius: 10px;
                    color: rgba(255,255,255,0.55);
                    text-decoration: none;
                    font-size: 13.5px;
                    font-weight: 500;
                    margin-bottom: 4px;
                    border: 1px solid transparent;
                }
                .lm-mobile-drawer-link.is-active {
                    background: rgba(108,63,255,0.16);
                    color: #F2F2F2;
                    border-color: rgba(108,63,255,0.35);
                }
                .lm-mobile-drawer-footer {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    border-radius: 10px;
                    color: rgba(255,255,255,0.4);
                    text-decoration: none;
                    font-size: 12.5px;
                    border-top: 1px solid rgba(255,255,255,0.08);
                    margin-top: 4px;
                }

                @media (max-width: 768px) {
                    .lm-root {
                        flex-direction: column !important;
                        height: 100dvh !important;
                        min-height: 100dvh !important;
                        width: 100% !important;
                        max-width: 100vw !important;
                        min-width: 0 !important;
                        overflow: hidden !important;
                    }
                    .lm-sidebar { display: none !important; }
                    .lm-mobile-nav {
                        display: block;
                        position: sticky;
                        top: 0;
                        z-index: 30;
                        flex-shrink: 0;
                        width: 100%;
                        background: rgba(13,13,13,0.96);
                        backdrop-filter: blur(16px);
                        -webkit-backdrop-filter: blur(16px);
                        border-bottom: 1px solid rgba(255,255,255,0.08);
                    }
                    .lm-main {
                        flex: 1 1 auto !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        min-width: 0 !important;
                        min-height: 0 !important;
                        padding: 12px 12px calc(16px + env(safe-area-inset-bottom, 0px)) !important;
                        overflow-x: hidden !important;
                        overflow-y: auto !important;
                        -webkit-overflow-scrolling: touch;
                    }
                    .lm-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }

                    .lm-dash-header {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 12px !important;
                    }

                    .lm-carriers-page {
                        height: auto !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                    }
                    .lm-carriers-header {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 10px !important;
                    }
                    .lm-carriers-actions {
                        display: flex !important;
                        flex-wrap: wrap !important;
                        gap: 8px !important;
                    }
                    .lm-carriers-actions > button {
                        flex: 1 1 auto;
                        justify-content: center;
                    }
                    .lm-carriers-body {
                        flex-direction: column !important;
                        overflow: visible !important;
                        height: auto !important;
                        min-height: 0 !important;
                    }
                    .lm-carriers-boards {
                        order: 2;
                        overflow: visible !important;
                        padding-right: 0 !important;
                    }
                    .lm-carriers-unassigned {
                        order: 1;
                        width: 100% !important;
                        max-height: none !important;
                        overflow: visible !important;
                        margin-bottom: 4px;
                    }
                    .lm-carriers-unassigned-scroll {
                        max-height: 280px !important;
                        overflow-y: auto !important;
                    }
                    .lm-board-col {
                        min-width: min(78vw, 270px) !important;
                        flex: 0 0 min(78vw, 270px) !important;
                    }
                    .lm-board-scroll {
                        touch-action: pan-x pan-y !important;
                        -webkit-overflow-scrolling: touch;
                    }
                    .lm-archive-panel {
                        max-height: none !important;
                    }
                    .lm-archive-toolbar {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 10px !important;
                    }
                    .lm-archive-toolbar-controls {
                        flex-wrap: wrap !important;
                        width: 100%;
                    }
                    .lm-archive-search {
                        width: 100% !important;
                        flex: 1 1 140px !important;
                    }
                    .lm-archive-search input {
                        width: 100% !important;
                    }
                    .lm-archive-row {
                        flex-wrap: wrap !important;
                    }
                    .lm-location-grid {
                        grid-template-columns: 1fr !important;
                    }
                    .lm-verify-modal {
                        width: calc(100vw - 24px) !important;
                        max-width: none !important;
                        padding: 16px !important;
                        max-height: calc(100dvh - 24px) !important;
                    }
                }

                @media (max-width: 420px) {
                    .lm-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
                }

                @media print {
                    .lm-sidebar { display: none !important; }
                    .lm-mobile-nav { display: none !important; }
                    .lm-orbs { display: none !important; }
                    .lm-root { overflow: visible !important; background: white !important; }
                    .lm-main { overflow: visible !important; padding: 0 !important; }
                    body { background: white !important; margin: 0; padding: 0; }
                }
            `}</style>
        </div>
    );
}
