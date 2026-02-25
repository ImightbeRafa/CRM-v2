'use client';

import Link from 'next/link';
import { Truck, Mail, ArrowRight } from 'lucide-react';

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;

export default function GuiasPage() {
    return (
        <div>
            <div style={{ marginBottom: 32 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Generador de Guías</h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Selecciona el tipo de guía a generar e imprimir en lote</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 700 }}>
                {[
                    { href: '/logistics/guias/mensajeria', color: '#8b87ff', icon: <Truck size={28} />, title: 'Mensajería Privada', desc: 'Green Delivery · Guías de recolección y entrega', badge: 'Mensajería' },
                    { href: '/logistics/guias/correos', color: '#60a5fa', icon: <Mail size={28} />, title: 'Correos de Costa Rica', desc: 'Guías postales · Certificados de envío', badge: 'Correos CR' },
                ].map(({ href, color, icon, title, desc, badge }) => (
                    <Link key={href} href={href} style={{ textDecoration: 'none' }}>
                        <div style={{ ...glass, padding: '28px 26px', cursor: 'pointer', border: `1px solid ${color}25`, position: 'relative', overflow: 'hidden', transition: 'all 0.2s' }} className="guia-card">
                            <div style={{ position: 'absolute', top: 0, right: 0, width: 140, height: 140, borderRadius: '50%', background: `radial-gradient(circle, ${color}20 0%, transparent 70%)`, transform: 'translate(30%,-30%)' }} />
                            <div style={{ color, marginBottom: 16, filter: `drop-shadow(0 0 12px ${color}60)` }}>{icon}</div>
                            <span style={{ padding: '2px 10px', borderRadius: 20, background: `${color}18`, color, fontSize: 10.5, fontWeight: 700, display: 'inline-block', marginBottom: 12 }}>{badge}</span>
                            <h3 style={{ color: '#F2F2F2', fontSize: 17, fontWeight: 700, margin: '0 0 6px' }}>{title}</h3>
                            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12.5, margin: '0 0 20px', lineHeight: 1.5 }}>{desc}</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color, fontSize: 12.5, fontWeight: 600 }}>
                                Generar Guías <ArrowRight size={13} />
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
            <style>{`.guia-card:hover{background:rgba(255,255,255,0.08)!important;transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,0.3)}`}</style>
        </div>
    );
}
