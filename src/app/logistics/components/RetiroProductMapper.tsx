'use client';

import { useEffect, useMemo, useState } from 'react';

export type RetiroMapStockItem = {
  sku: string;
  displayName: string;
  qty: number;
};

interface RetiroProductMapperProps {
  rawName: string;
  qty: number;
  sku: string | null;
  displayName: string | null;
  unitHint?: string | null;
  stock: RetiroMapStockItem[];
  disabled?: boolean;
  onMap: (sku: string, overwrite: boolean) => Promise<void>;
}

export default function RetiroProductMapper({
  rawName,
  qty,
  sku,
  displayName,
  unitHint = null,
  stock,
  disabled = false,
  onMap,
}: RetiroProductMapperProps) {
  const mapped = Boolean(sku);
  const [editing, setEditing] = useState(false);
  const [selectedSku, setSelectedSku] = useState(sku || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setSelectedSku(sku || '');
  }, [sku, editing]);

  const sortedStock = useMemo(
    () => [...stock].sort((a, b) => a.displayName.localeCompare(b.displayName, 'es')),
    [stock],
  );

  const selected = sortedStock.find((item) => item.sku === selectedSku) || null;
  const showForm = !mapped || editing;
  const canSubmit = !!selectedSku && !saving && !disabled && (!mapped || selectedSku !== sku);

  async function submit(overwrite: boolean) {
    if (!selectedSku || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onMap(selectedSku, overwrite);
      setEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'No se pudo mapear el producto';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        background: mapped && !editing ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.08)',
        border: `1px solid ${mapped && !editing ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.25)'}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: mapped && !editing ? 'rgba(255,255,255,0.8)' : '#f87171', fontSize: 12.5, fontWeight: 700 }}>
            {displayName || rawName}{mapped ? '' : ' (sin mapear)'}
          </div>
          {unitHint && (
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>
              {unitHint} — elige un SKU Laura distinto si este pedido mezcla productos
            </div>
          )}
          {mapped && displayName && displayName !== rawName && !editing && (
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
              Pedido: {rawName}
            </div>
          )}
        </div>
        <div style={{ color: mapped && !editing ? '#22c55e' : '#f87171', fontWeight: 900, fontSize: 13, flexShrink: 0 }}>
          ×{qty}
        </div>
      </div>

      {showForm ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={selectedSku}
              disabled={disabled || saving || sortedStock.length === 0}
              onChange={(e) => {
                setSelectedSku(e.target.value);
                setError(null);
              }}
              style={{
                flex: 1, minWidth: 160, boxSizing: 'border-box',
                padding: '7px 8px', borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)', color: '#F2F2F2', fontSize: 12, outline: 'none',
                colorScheme: 'dark',
              }}
            >
              <option value="">Elegir SKU Laura...</option>
              {sortedStock.map((item) => (
                <option key={item.sku} value={item.sku}>
                  {item.displayName} · {item.qty} u.
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submit(mapped)}
              style={{
                padding: '7px 10px', borderRadius: 7, fontSize: 12, fontWeight: 800,
                border: `1px solid ${canSubmit ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.1)'}`,
                background: canSubmit ? 'rgba(34,197,94,0.14)' : 'transparent',
                color: canSubmit ? '#22c55e' : 'rgba(255,255,255,0.25)',
                cursor: canSubmit ? 'pointer' : 'default',
              }}
            >
              {saving ? 'Guardando...' : mapped ? 'Actualizar' : 'Mapear'}
            </button>
            {editing && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setSelectedSku(sku || '');
                  setError(null);
                }}
                style={{
                  padding: '7px 10px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: 'rgba(255,255,255,0.45)',
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                Cancelar
              </button>
            )}
          </div>
          {sortedStock.length === 0 && (
            <div style={{ marginTop: 6, color: '#fbbf24', fontSize: 11 }}>
              No hay SKUs activos en el inventario de Laura.
            </div>
          )}
          {selected && (
            <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
              Al confirmar retiro en Laura se descontarán {qty} de {selected.displayName} (hay {selected.qty}).
            </div>
          )}
          <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.32)', fontSize: 10.5, lineHeight: 1.4 }}>
            Este mapeo queda guardado para futuros pedidos con el mismo nombre de producto.
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            Inventario Laura · {displayName || sku}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setSelectedSku(sku || '');
              setEditing(true);
              setError(null);
            }}
            style={{
              padding: 0, border: 'none', background: 'none',
              color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 700,
              cursor: disabled ? 'default' : 'pointer', textDecoration: 'underline',
            }}
          >
            Cambiar
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 6, color: '#f87171', fontSize: 11 }}>{error}</div>
      )}
    </div>
  );
}
