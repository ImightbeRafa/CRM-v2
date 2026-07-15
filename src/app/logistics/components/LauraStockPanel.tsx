'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Package, Plus, RefreshCw } from 'lucide-react';

const glass = {
  background: 'rgba(255,255,255,0.05)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
} as const;

export type LauraStockItem = {
  sku: string;
  displayName: string;
  qty: number;
  minQty: number;
  lowStock: boolean;
};

type Movement = {
  id: string;
  sku: string;
  displayName: string | null;
  delta: number;
  reason: string;
  notes: string | null;
  createdAt: string;
};

interface LauraStockPanelProps {
  stock: LauraStockItem[];
  unitsOnHand: number;
  lowStockCount: number;
  movements?: Movement[];
  busy?: boolean;
  onRestock: (sku: string, delta: number, notes: string) => Promise<void>;
  onRefresh: () => void;
}

export default function LauraStockPanel({
  stock,
  unitsOnHand,
  lowStockCount,
  movements = [],
  busy = false,
  onRestock,
  onRefresh,
}: LauraStockPanelProps) {
  const [restockSku, setRestockSku] = useState<string | null>(null);
  const [qty, setQty] = useState('10');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => stock.find((s) => s.sku === restockSku) || null,
    [stock, restockSku],
  );

  async function submitRestock() {
    if (!selected) return;
    const delta = Number(qty);
    if (!Number.isInteger(delta) || delta === 0) {
      alert('Ingresá una cantidad entera distinta de 0');
      return;
    }
    setSaving(true);
    try {
      await onRestock(selected.sku, delta, notes.trim());
      setRestockSku(null);
      setQty('10');
      setNotes('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ ...glass, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Package size={16} style={{ color: '#fbbf24' }} />
            <h2 style={{ margin: 0, color: '#F2F2F2', fontSize: 15, fontWeight: 800 }}>Inventario Casa de Laura</h2>
          </div>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
            Stock local para retiros RA · {unitsOnHand} unidades ·{' '}
            <span style={{ color: lowStockCount > 0 ? '#fbbf24' : 'rgba(34,197,94,0.85)' }}>
              {lowStockCount > 0 ? `${lowStockCount} bajos` : 'niveles OK'}
            </span>
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={busy}
          style={{ padding: '7px 10px', ...glass, color: 'rgba(255,255,255,0.45)', cursor: busy ? 'default' : 'pointer' }}
          title="Actualizar inventario"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {lowStockCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          padding: '8px 10px', borderRadius: 8,
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
          color: '#fbbf24', fontSize: 12, fontWeight: 600,
        }}>
          <AlertTriangle size={13} />
          Hay productos bajos — enviá reposición a Laura pronto.
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 8,
      }}>
        {stock.map((item) => (
          <div
            key={item.sku}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${item.lowStock ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.08)'}`,
              background: item.lowStock ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
            }}
          >
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
              {item.displayName}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{
                color: item.lowStock ? '#ef4444' : '#F2F2F2',
                fontSize: 22,
                fontWeight: 900,
                lineHeight: 1,
              }}>
                {item.qty}
              </span>
              <button
                onClick={() => { setRestockSku(item.sku); setQty('10'); setNotes(''); }}
                style={{
                  padding: '4px 8px', borderRadius: 6,
                  border: '1px solid rgba(34,197,94,0.3)',
                  background: 'rgba(34,197,94,0.1)',
                  color: '#22c55e', fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                }}
              >
                <Plus size={11} /> Stock
              </button>
            </div>
            <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.28)', fontSize: 10 }}>
              mín. {item.minQty}
            </div>
          </div>
        ))}
      </div>

      {movements.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
            Movimientos recientes
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
            {movements.slice(0, 8).map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                <span>
                  <span style={{ color: m.delta > 0 ? '#22c55e' : '#f87171', fontWeight: 700 }}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </span>
                  {' '}{m.displayName || m.sku}
                  {m.notes ? ` · ${m.notes}` : ''}
                </span>
                <span style={{ whiteSpace: 'nowrap', opacity: 0.7 }}>
                  {new Date(m.createdAt).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!saving) setRestockSku(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 380,
              background: 'rgba(22,24,32,0.98)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 16, padding: 22,
            }}
          >
            <h3 style={{ margin: '0 0 6px', color: '#F2F2F2', fontSize: 16, fontWeight: 800 }}>
              Ajustar stock — {selected.displayName}
            </h3>
            <p style={{ margin: '0 0 14px', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
              Actual: {selected.qty}. Usá número positivo para envío / reposición, negativo para corrección.
            </p>
            <label style={{ display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 6 }}>Cantidad</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 12,
                padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)', color: '#F2F2F2', fontSize: 14, outline: 'none',
              }}
            />
            <label style={{ display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 6 }}>Nota (opcional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Envío 13 de julio"
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 16,
                padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)', color: '#F2F2F2', fontSize: 13, outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRestockSku(null)}
                disabled={saving}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={submitRestock}
                disabled={saving}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 800, cursor: saving ? 'default' : 'pointer' }}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
