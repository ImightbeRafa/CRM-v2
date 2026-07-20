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

const QUICK_DELTAS = [5, 10, 20];

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

  const sortedStock = useMemo(() => {
    return [...stock].sort((a, b) => {
      if (a.lowStock !== b.lowStock) return a.lowStock ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, 'es');
    });
  }, [stock]);

  const selected = useMemo(
    () => stock.find((s) => s.sku === restockSku) || null,
    [stock, restockSku],
  );

  const previewDelta = Number(qty);
  const previewNext = selected && Number.isInteger(previewDelta)
    ? selected.qty + previewDelta
    : null;

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

  function openRestock(sku: string) {
    setRestockSku(sku);
    setQty('10');
    setNotes('');
  }

  return (
    <div style={{ ...glass, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Package size={16} style={{ color: '#fbbf24' }} />
            <h2 style={{ margin: 0, color: '#F2F2F2', fontSize: 15, fontWeight: 800 }}>Inventario Casa de Laura</h2>
          </div>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 1.45 }}>
            Inventario solo para retiros en Laura Escazu · {unitsOnHand} unidades ·{' '}
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
          Hay productos bajos — reponé stock pronto.
        </div>
      )}

      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
              {['Producto', 'Stock', 'Mín', 'Estado', 'Reponer'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Stock' || h === 'Mín' || h === 'Reponer' ? 'right' : 'left',
                    padding: '10px 12px',
                    color: 'rgba(255,255,255,0.35)',
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedStock.map((item) => (
              <tr
                key={item.sku}
                style={{
                  background: item.lowStock ? 'rgba(239,68,68,0.05)' : 'transparent',
                }}
              >
                <td style={{ padding: '11px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ color: '#F2F2F2', fontSize: 13, fontWeight: 700 }}>{item.displayName}</div>
                  <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10, marginTop: 2 }}>{item.sku}</div>
                </td>
                <td style={{
                  padding: '11px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  textAlign: 'right', fontSize: 20, fontWeight: 900,
                  color: item.lowStock ? '#ef4444' : '#F2F2F2',
                }}>
                  {item.qty}
                </td>
                <td style={{
                  padding: '11px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                  textAlign: 'right', color: 'rgba(255,255,255,0.4)', fontSize: 12,
                }}>
                  {item.minQty}
                </td>
                <td style={{ padding: '11px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                    background: item.lowStock ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
                    color: item.lowStock ? '#f87171' : '#22c55e',
                  }}>
                    {item.lowStock ? 'Bajo' : 'OK'}
                  </span>
                </td>
                <td style={{ padding: '11px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'right' }}>
                  <button
                    onClick={() => openRestock(item.sku)}
                    style={{
                      padding: '6px 10px', borderRadius: 7,
                      border: '1px solid rgba(34,197,94,0.35)',
                      background: 'rgba(34,197,94,0.1)',
                      color: '#22c55e', fontSize: 11, fontWeight: 800,
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Plus size={12} /> Reponer
                  </button>
                </td>
              </tr>
            ))}
            {sortedStock.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 28, textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
                  Sin productos en inventario
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {movements.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
            Movimientos recientes
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 160, overflowY: 'auto' }}>
            {movements.slice(0, 12).map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: 'rgba(255,255,255,0.42)' }}>
                <span>
                  <span style={{ color: m.delta > 0 ? '#22c55e' : '#f87171', fontWeight: 800 }}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </span>
                  {' '}{m.displayName || m.sku}
                  <span style={{ opacity: 0.65 }}> · {m.reason}</span>
                  {m.notes ? ` · ${m.notes}` : ''}
                </span>
                <span style={{ whiteSpace: 'nowrap', opacity: 0.7 }}>
                  {new Date(m.createdAt).toLocaleString('es-CR', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
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
              width: '100%', maxWidth: 400,
              background: 'rgba(22,24,32,0.98)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 16, padding: 22,
            }}
          >
            <h3 style={{ margin: '0 0 6px', color: '#F2F2F2', fontSize: 16, fontWeight: 800 }}>
              Reponer — {selected.displayName}
            </h3>
            <p style={{ margin: '0 0 12px', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
              Actual: <strong style={{ color: '#F2F2F2' }}>{selected.qty}</strong>
              {previewNext != null && Number.isFinite(previewNext) && (
                <> → <strong style={{ color: previewNext < selected.minQty ? '#f87171' : '#22c55e' }}>{previewNext}</strong></>
              )}
            </p>

            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {QUICK_DELTAS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQty(String(n))}
                  style={{
                    padding: '6px 12px', borderRadius: 8,
                    border: `1px solid ${qty === String(n) ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.1)'}`,
                    background: qty === String(n) ? 'rgba(34,197,94,0.12)' : 'transparent',
                    color: qty === String(n) ? '#22c55e' : 'rgba(255,255,255,0.55)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  +{n}
                </button>
              ))}
            </div>

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
              placeholder="Ej. Envío 15 de julio"
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
