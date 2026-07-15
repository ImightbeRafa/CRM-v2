'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export type PaymentMethod = 'sinpe' | 'efectivo';

export type PaymentConfirmPayload = {
    method: PaymentMethod;
    employeeId: string;
    employeeName: string;
};

type EmployeeOption = {
    id: string;
    displayName: string;
    active: boolean;
};

interface PaymentMethodWizardProps {
    open: boolean;
    title: string;
    subtitle?: string;
    amountLabel?: string;
    amount?: number;
    confirmLabel?: string;
    employeeLabel?: string;
    busy?: boolean;
    onConfirm: (payload: PaymentConfirmPayload) => void;
    onCancel: () => void;
}

function fmt(amount: number) {
    return `₡${(amount || 0).toLocaleString('es-CR')}`;
}

export default function PaymentMethodWizard({
    open,
    title,
    subtitle,
    amountLabel,
    amount,
    confirmLabel = 'Confirmar',
    employeeLabel = 'Quién confirma',
    busy = false,
    onConfirm,
    onCancel,
}: PaymentMethodWizardProps) {
    const [method, setMethod] = useState<PaymentMethod | null>(null);
    const [employeeId, setEmployeeId] = useState('');
    const [employees, setEmployees] = useState<EmployeeOption[]>([]);
    const [employeesLoading, setEmployeesLoading] = useState(false);
    const [employeesError, setEmployeesError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setMethod(null);
        setEmployeeId('');
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
    const canConfirm = !!method && !!selectedEmployee && !busy && !employeesLoading;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-method-wizard-title"
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
                    width: '100%', maxWidth: 420,
                    background: 'rgba(22,24,32,0.98)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 16, padding: 22,
                    boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                    <div>
                        <h3 id="payment-method-wizard-title" style={{ margin: 0, color: '#F2F2F2', fontSize: 17, fontWeight: 800 }}>{title}</h3>
                        {subtitle && <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.45)', fontSize: 12.5, lineHeight: 1.45 }}>{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        aria-label="Cerrar"
                        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: busy ? 'default' : 'pointer', padding: 4 }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {(amount != null || amountLabel) && (
                    <div style={{
                        marginBottom: 16, padding: '12px 14px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                        {amountLabel && <p style={{ margin: '0 0 4px', color: 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{amountLabel}</p>}
                        {amount != null && <p style={{ margin: 0, color: '#34d399', fontSize: 22, fontWeight: 900 }}>{fmt(amount)}</p>}
                    </div>
                )}

                <p style={{ margin: '0 0 10px', color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700 }}>Método de pago</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                    {([
                        { id: 'sinpe' as const, label: 'SINPE' },
                        { id: 'efectivo' as const, label: 'Efectivo' },
                    ]).map((opt) => {
                        const selected = method === opt.id;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                disabled={busy}
                                onClick={() => setMethod(opt.id)}
                                style={{
                                    padding: '14px 12px', borderRadius: 10, cursor: busy ? 'default' : 'pointer',
                                    border: `1px solid ${selected ? 'rgba(139,135,255,0.55)' : 'rgba(255,255,255,0.12)'}`,
                                    background: selected ? 'rgba(139,135,255,0.16)' : 'rgba(255,255,255,0.03)',
                                    color: selected ? '#c4c2ff' : 'rgba(255,255,255,0.7)',
                                    fontSize: 14, fontWeight: 800,
                                }}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </div>

                <label style={{ display: 'block', marginBottom: 16 }}>
                    <span style={{ display: 'block', marginBottom: 8, color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700 }}>
                        {employeeLabel}
                    </span>
                    <select
                        value={employeeId}
                        disabled={busy || employeesLoading || !!employeesError}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        style={{
                            width: '100%', padding: '10px 12px', borderRadius: 8,
                            border: '1px solid rgba(255,255,255,0.14)',
                            background: 'rgba(0,0,0,0.35)', color: '#F2F2F2',
                            fontSize: 13, fontWeight: 600, outline: 'none',
                        }}
                    >
                        <option value="">
                            {employeesLoading ? 'Cargando personal...' : 'Seleccionar empleado...'}
                        </option>
                        {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>{emp.displayName}</option>
                        ))}
                    </select>
                    {employeesError && (
                        <span style={{ display: 'block', marginTop: 6, color: '#f87171', fontSize: 11 }}>
                            {employeesError}. Revise Personal en logística.
                        </span>
                    )}
                    {!employeesLoading && !employeesError && employees.length === 0 && (
                        <span style={{ display: 'block', marginTop: 6, color: '#fbbf24', fontSize: 11 }}>
                            No hay empleados activos. Agréguelos en Personal.
                        </span>
                    )}
                </label>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        style={{
                            padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
                            background: 'transparent', color: 'rgba(255,255,255,0.55)', fontSize: 12.5, fontWeight: 700,
                            cursor: busy ? 'default' : 'pointer',
                        }}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        disabled={!canConfirm}
                        onClick={() => {
                            if (!method || !selectedEmployee) return;
                            onConfirm({
                                method,
                                employeeId: selectedEmployee.id,
                                employeeName: selectedEmployee.displayName,
                            });
                        }}
                        style={{
                            padding: '9px 16px', borderRadius: 8,
                            border: `1px solid ${canConfirm ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.08)'}`,
                            background: canConfirm ? 'rgba(52,211,153,0.14)' : 'transparent',
                            color: canConfirm ? '#34d399' : 'rgba(255,255,255,0.22)',
                            fontSize: 12.5, fontWeight: 900,
                            cursor: canConfirm ? 'pointer' : 'default',
                        }}
                    >
                        {busy ? 'Guardando...' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
