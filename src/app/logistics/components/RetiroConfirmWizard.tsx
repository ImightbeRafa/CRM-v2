'use client';

import { useEffect, useState } from 'react';
import { MapPin, PackageCheck, X } from 'lucide-react';
import {
  RETIRO_PICKUP_LOCATIONS,
  usesRetiroInventory,
  type RetiroPickupLocation,
} from '@/lib/retiro-locations';
import RetiroProductMapper, { type RetiroMapStockItem } from '@/app/logistics/components/RetiroProductMapper';

type EmployeeOption = {
  id: string;
  displayName: string;
  active: boolean;
};

export type RetiroLinePreview = {
  slotKey?: string;
  rawName: string;
  qty: number;
  sku: string | null;
  displayName: string | null;
  unitHint?: string | null;
};

export type RetiroConfirmPayload = {
  employeeId: string;
  employeeName: string;
  pickupLocation: RetiroPickupLocation;
};

interface RetiroConfirmWizardProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  lines: RetiroLinePreview[];
  stock?: RetiroMapStockItem[];
  busy?: boolean;
  onConfirm: (payload: RetiroConfirmPayload) => void;
  onCancel: () => void;
  onMapProduct?: (rawName: string, sku: string, overwrite: boolean, slotKey: string, qty: number) => Promise<void>;
}

const LOCATION_OPTIONS = (Object.entries(RETIRO_PICKUP_LOCATIONS) as [RetiroPickupLocation, string][]).map(
  ([id, label]) => ({ id, label }),
);

export default function RetiroConfirmWizard({
  open,
  title = 'Confirmar retiro',
  subtitle,
  lines,
  stock = [],
  busy = false,
  onConfirm,
  onCancel,
  onMapProduct,
}: RetiroConfirmWizardProps) {
  const [employeeId, setEmployeeId] = useState('');
  const [pickupLocation, setPickupLocation] = useState<RetiroPickupLocation | ''>('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmployeeId('');
    setPickupLocation('');
    setEmployeesError(null);

    let cancelled = false;
    (async () => {
      setEmployeesLoading(true);
      try {
        const res = await fetch('/api/logistics/workforce/employees');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo cargar personal');
        const list = (data.employees || [])
          .filter((e: EmployeeOption) => e.active)
          .map((e: EmployeeOption) => ({
            id: e.id,
            displayName: e.displayName,
            active: e.active,
          }));
        if (!cancelled) setEmployees(list);
      } catch (err: any) {
        if (!cancelled) {
          setEmployees([]);
          setEmployeesError(err.message || 'No se pudo cargar personal');
        }
      } finally {
        if (!cancelled) setEmployeesLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const selectedEmployee = employees.find((e) => e.id === employeeId) || null;
  const tracksInventory = !!pickupLocation && usesRetiroInventory(pickupLocation);
  const unmapped = lines.filter((l) => !l.sku);
  const canConfirm = !!selectedEmployee
    && !!pickupLocation
    && (!tracksInventory || unmapped.length === 0)
    && !busy
    && !employeesLoading;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520,
          background: 'rgba(22,24,32,0.98)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16, padding: 22,
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, color: '#F2F2F2', fontSize: 17, fontWeight: 800 }}>{title}</h3>
            {subtitle && (
              <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.45)', fontSize: 12.5, lineHeight: 1.45 }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          }}>
            <MapPin size={12} /> Lugar de retiro
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {LOCATION_OPTIONS.map((loc) => {
              const selected = pickupLocation === loc.id;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setPickupLocation(loc.id)}
                  disabled={busy}
                  style={{
                    padding: '12px 10px', borderRadius: 10, textAlign: 'left',
                    border: `1px solid ${selected ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    background: selected ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.03)',
                    color: selected ? '#22c55e' : 'rgba(255,255,255,0.7)',
                    cursor: busy ? 'default' : 'pointer', fontWeight: selected ? 800 : 600, fontSize: 13,
                  }}
                >
                  {loc.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Impacto en inventario
          </div>
          {!pickupLocation ? (
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
              Seleccioná el lugar de retiro para ver si aplica inventario Laura.
            </p>
          ) : !tracksInventory ? (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.55)', fontSize: 12.5, lineHeight: 1.45,
            }}>
              Marlenn Desamparados — sin impacto en inventario. No se requiere mapear productos.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lines.map((line, idx) => (
                  onMapProduct ? (
                    <RetiroProductMapper
                      key={line.slotKey || `${line.rawName}-${idx}`}
                      rawName={line.rawName}
                      qty={line.qty}
                      sku={line.sku}
                      displayName={line.displayName}
                      unitHint={line.unitHint}
                      stock={stock}
                      disabled={busy}
                      onMap={(sku, overwrite) => onMapProduct(line.rawName, sku, overwrite, line.slotKey || String(idx), line.qty)}
                    />
                  ) : (
                    <div
                      key={`${line.rawName}-${idx}`}
                      style={{
                        display: 'flex', justifyContent: 'space-between', gap: 8,
                        padding: '8px 10px', borderRadius: 8,
                        background: line.sku ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.08)',
                        border: `1px solid ${line.sku ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.25)'}`,
                      }}
                    >
                      <div>
                        <div style={{ color: '#F2F2F2', fontSize: 12.5, fontWeight: 700 }}>
                          {line.displayName || line.rawName}
                        </div>
                        {!line.sku && (
                          <div style={{ color: '#f87171', fontSize: 11, marginTop: 2 }}>
                            No mapeado · “{line.rawName}”
                          </div>
                        )}
                        {line.sku && line.displayName !== line.rawName && (
                          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
                            {line.rawName}
                          </div>
                        )}
                      </div>
                      <div style={{ color: line.sku ? '#22c55e' : '#f87171', fontWeight: 900, fontSize: 13 }}>
                        −{line.qty}
                      </div>
                    </div>
                  )
                ))}
              </div>
              {unmapped.length > 0 && (
                <p style={{ margin: '10px 0 0', color: '#f87171', fontSize: 12 }}>
                  Mapear cada unidad al inventario de Laura. Pedidos mixtos (1 Dopa + 1 Stress) deben ir a SKUs distintos.
                </p>
              )}
            </>
          )}
        </div>

        <label style={{ display: 'block', color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 6 }}>
          Quién entregó el pedido
        </label>
        {employeesLoading ? (
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginBottom: 14 }}>Cargando personal...</div>
        ) : employeesError ? (
          <div style={{ color: '#f87171', fontSize: 12, marginBottom: 14 }}>{employeesError}</div>
        ) : (
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', marginBottom: 16,
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)', color: '#F2F2F2', fontSize: 13, outline: 'none',
            }}
          >
            <option value="">Seleccionar empleado...</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.displayName}</option>
            ))}
          </select>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '9px 14px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent', color: 'rgba(255,255,255,0.5)',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              if (!selectedEmployee || !pickupLocation || !canConfirm) return;
              onConfirm({
                employeeId: selectedEmployee.id,
                employeeName: selectedEmployee.displayName,
                pickupLocation,
              });
            }}
            disabled={!canConfirm}
            style={{
              padding: '9px 14px', borderRadius: 8,
              border: `1px solid ${canConfirm ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.1)'}`,
              background: canConfirm ? 'rgba(34,197,94,0.15)' : 'transparent',
              color: canConfirm ? '#22c55e' : 'rgba(255,255,255,0.25)',
              fontWeight: 800, cursor: canConfirm ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <PackageCheck size={14} />
            {busy ? 'Confirmando...' : 'Confirmar retiro'}
          </button>
        </div>
      </div>
    </div>
  );
}
