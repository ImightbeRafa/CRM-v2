import { Inter } from 'next/font/google';
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
import { LogisticsTableLabels } from './components/LogisticsTableLabels';
import { LOGISTICS_CSS } from './logistics-styles';

const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    weight: ['400', '500', '600', '700'],
});

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
        <div className={`lm-root theme-static ${inter.className}`} style={{
            display: 'flex',
            minHeight: '100vh',
            background: '#0D0D0D',
            position: 'relative',
            overflow: 'hidden',
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

            <LogisticsTableLabels />
            <style>{LOGISTICS_CSS}</style>
        </div>
    );
}
