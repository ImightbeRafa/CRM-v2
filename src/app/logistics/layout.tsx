import { redirect } from 'next/navigation';
import { requireLogisticsAdmin } from '@/lib/logistics-auth';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
    LayoutDashboard,
    Layers,
    Settings,
    BookOpen,
    LogOut,
    Package,
    PackageCheck,
    BarChart2,
    FileText,
    Shield,
} from 'lucide-react';

export const metadata: Metadata = {
    title: 'HolaMA · Logistics Manager',
    icons: {
        icon: '/favicon-logistics.svg',
    },
};

export default async function LogisticsLayout({ children }: { children: React.ReactNode }) {
    const session = await requireLogisticsAdmin();
    if (!session) redirect('/dashboard');

    const navItems = [
        { href: '/logistics', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/logistics/carriers', label: 'Tablero de Envíos', icon: Layers },
        { href: '/logistics/retiros', label: 'Retiros', icon: PackageCheck },
        { href: '/logistics/config', label: 'Costos y Tarifas', icon: Settings },
        { href: '/logistics/accounting', label: 'Contabilidad', icon: BookOpen },
        { href: '/logistics/reports', label: 'Reportes', icon: BarChart2 },
        { href: '/logistics/guias', label: 'Guías', icon: FileText },
        { href: '/logistics/admin', label: 'Admin', icon: Shield },
    ];

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
                {/* Blue top-right orb */}
                <div style={{
                    position: 'absolute', top: '-15%', right: '-10%',
                    width: 600, height: 600, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)',
                    filter: 'blur(60px)',
                }} />
                {/* Purple bottom-left orb */}
                <div style={{
                    position: 'absolute', bottom: '-15%', left: '-5%',
                    width: 700, height: 700, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(108,63,255,0.16) 0%, transparent 70%)',
                    filter: 'blur(80px)',
                }} />
                {/* Accent middle orb */}
                <div style={{
                    position: 'absolute', top: '45%', left: '35%',
                    width: 400, height: 400, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(139,87,246,0.08) 0%, transparent 70%)',
                    filter: 'blur(60px)',
                }} />
            </div>

            {/* ── Mobile top nav ──────────────────────────── */}
            <div className="lm-mobile-nav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: 'linear-gradient(135deg, #6c3fff, #3b82f6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <Package size={15} color="white" />
                    </div>
                    <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13, margin: 0 }}>HolaMA</p>
                    <Link href="/dashboard" style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 11 }}>
                        <LogOut size={14} />
                    </Link>
                </div>
                <nav style={{ display: 'flex', overflowX: 'auto', gap: 4, padding: '8px 12px', WebkitOverflowScrolling: 'touch' }}>
                    {navItems.map(({ href, label, icon: Icon }) => (
                        <Link key={href} href={href} className="lm-nav-link" style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '6px 10px', borderRadius: 8,
                            color: 'rgba(255,255,255,0.5)', textDecoration: 'none',
                            fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
                            border: '1px solid transparent', flexShrink: 0,
                        }}>
                            <Icon size={13} />
                            {label}
                        </Link>
                    ))}
                </nav>
            </div>

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
                {/* Logo */}
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

                {/* Nav */}
                <nav style={{ flex: 1, padding: '14px 12px' }}>
                    {navItems.map(({ href, label, icon: Icon }) => (
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

                {/* Footer */}
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
                @media (max-width: 768px) {
                    .lm-sidebar { display: none !important; }
                    .lm-mobile-nav { display: block; position: sticky; top: 0; z-index: 20; background: rgba(13,13,13,0.95); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-bottom: 1px solid rgba(255,255,255,0.08); }
                    .lm-main { padding: 16px !important; }
                    .lm-stat-grid { grid-template-columns: repeat(3, 1fr) !important; }
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
