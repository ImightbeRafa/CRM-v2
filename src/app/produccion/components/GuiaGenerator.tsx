'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Sale } from '../types/sales';
import { Button } from '@/app/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Checkbox } from '@/app/components/ui/checkbox';
import { ScrollArea } from '@/app/components/ui/scroll-area';
import { Badge } from '@/app/components/ui/badge';
import {
  Truck,
  Download,
  CheckCircle,
  XCircle,
  Loader2,
  Zap,
  FileText,
  Clock,
  RefreshCw,
  AlertTriangle,
  Printer,
  ChevronLeft,
  Search,
} from 'lucide-react';
import {
  costaRicaLocations,
  provinceNames,
  type ProvinceData,
  type CantonData,
} from '@/app/ventas/components/costaRicaLocations';

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const normalizeText = (value: string | undefined | null) => {
  const s = (value ?? '').toString();
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

const findProvince = (name: string): ProvinceData | undefined =>
  costaRicaLocations.find((p) => normalizeText(p.nombre) === normalizeText(name));

const findCanton = (province: ProvinceData | undefined, name: string): CantonData | undefined =>
  province?.cantones.find((c) => normalizeText(c.nombre) === normalizeText(name));

// ─── Types ──────────────────────────────────────────────────

interface GuiaGeneratorProps {
  open: boolean;
  orders: Sale[];
  onClose: () => void;
  onUpdateOrder: (orderId: string, updatedData: Partial<Sale>) => Promise<Sale>;
}

interface GuiaStatus {
  id: string;
  orderId: string;
  carrier: string;
  guiaNumber: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: string | null;
  errorMessage: string | null;
  hasPdf: boolean;
  pdfFileName: string | null;
  createdAt: string;
  updatedAt: string;
  customerName: string | null;
  product: string | null;
  province: string | null;
  canton: string | null;
  district: string | null;
  quantity: number | null;
  phone: string | null;
}

interface OrderGuiaData {
  orderId: string;
  guiaNumber: string;
  selected: boolean;
  status?: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
  trackingNumber?: string;
  pdfDownloaded?: boolean;
}

interface ShippingConfig {
  id: string;
  carrier: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  settings?: Record<string, any>;
}

interface VerifiedOrder {
  orderId: string;
  customerName: string;
  province: string;
  canton: string;
  district: string;
  address: string;
  phone: string;
  product: string;
  quantity: number;
  valid: boolean;
}

// ─── Location Row ───────────────────────────────────────────

function LocationRow({
  order,
  onChange,
}: {
  order: VerifiedOrder;
  onChange: (updates: Partial<VerifiedOrder>) => void;
}) {
  const [cantonSearch, setCantonSearch] = useState(order.canton);
  const [districtSearch, setDistrictSearch] = useState(order.district);
  const [cantonOpen, setCantonOpen] = useState(false);
  const [districtOpen, setDistrictOpen] = useState(false);

  const province = useMemo(() => findProvince(order.province), [order.province]);
  const canton = useMemo(() => findCanton(province, order.canton), [province, order.canton]);

  const cantonResults = useMemo(() => {
    const search = normalizeText(cantonSearch);
    if (!search)
      return (
        province?.cantones.map((c) => ({ province: province!.nombre, canton: c.nombre })).slice(0, 15) || []
      );
    return costaRicaLocations
      .flatMap((p) => p.cantones.map((c) => ({ province: p.nombre, canton: c.nombre })))
      .filter((item) => normalizeText(item.canton).includes(search))
      .slice(0, 12);
  }, [cantonSearch, province]);

  const districtResults = useMemo(() => {
    const search = normalizeText(districtSearch);
    if (!search)
      return (
        canton?.distritos
          .map((d) => ({ province: province?.nombre || '', canton: canton!.nombre, district: d }))
          .slice(0, 15) || []
      );
    return costaRicaLocations
      .flatMap((p) =>
        p.cantones.flatMap((c) => c.distritos.map((d) => ({ province: p.nombre, canton: c.nombre, district: d })))
      )
      .filter((item) => normalizeText(item.district).includes(search))
      .slice(0, 12);
  }, [districtSearch, canton, province]);

  useEffect(() => {
    setCantonSearch(order.canton);
  }, [order.canton]);
  useEffect(() => {
    setDistrictSearch(order.district);
  }, [order.district]);

  const isValid =
    !!province &&
    !!canton &&
    canton.distritos.some((d) => normalizeText(d) === normalizeText(order.district));

  return (
    <div
      className={`rounded-lg border p-3.5 mb-2 transition-colors ${
        isValid
          ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/10'
          : 'border-amber-200 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/10'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        {isValid ? (
          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
        )}
        <span className="font-semibold text-sm truncate">{order.customerName}</span>
        <span className="text-xs text-muted-foreground">#{order.orderId}</span>
      </div>

      {/* Provincia / Cantón / Distrito grid */}
      <div className="grid grid-cols-3 gap-2.5 mb-2.5">
        {/* Provincia */}
        <div>
          <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
            Provincia
          </label>
          <select
            value={province?.nombre || order.province}
            onChange={(e) => {
              const p = costaRicaLocations.find((pr) => pr.nombre === e.target.value);
              onChange({ province: p?.nombre || e.target.value, canton: '', district: '' });
              setCantonSearch('');
              setDistrictSearch('');
            }}
            className={`w-full px-2.5 py-1.5 rounded-md text-xs border bg-background outline-none ${
              province ? 'border-emerald-300 dark:border-emerald-700' : 'border-amber-300 dark:border-amber-700'
            }`}
          >
            <option value="">Seleccione</option>
            {provinceNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* Cantón */}
        <div className="relative">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
            Cantón
          </label>
          <input
            value={cantonSearch}
            onChange={(e) => {
              setCantonSearch(e.target.value);
              setCantonOpen(true);
            }}
            onFocus={() => setCantonOpen(true)}
            onBlur={() => setTimeout(() => setCantonOpen(false), 150)}
            placeholder="Buscar cantón"
            className={`w-full px-2.5 py-1.5 rounded-md text-xs border bg-background outline-none ${
              canton ? 'border-emerald-300 dark:border-emerald-700' : 'border-amber-300 dark:border-amber-700'
            }`}
          />
          {cantonOpen && cantonResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 max-h-48 overflow-y-auto rounded-lg border bg-popover shadow-lg mt-0.5">
              {cantonResults.map((r) => (
                <button
                  key={`${r.province}-${r.canton}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ province: r.province, canton: r.canton, district: '' });
                    setCantonSearch(r.canton);
                    setDistrictSearch('');
                    setCantonOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-accent transition-colors border-b border-border/30 last:border-b-0"
                >
                  <div className="text-xs font-medium">{r.canton}</div>
                  <div className="text-[10px] text-muted-foreground">{r.province}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Distrito */}
        <div className="relative">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
            Distrito
          </label>
          <input
            value={districtSearch}
            onChange={(e) => {
              setDistrictSearch(e.target.value);
              setDistrictOpen(true);
            }}
            onFocus={() => setDistrictOpen(true)}
            onBlur={() => setTimeout(() => setDistrictOpen(false), 150)}
            placeholder="Buscar distrito"
            className={`w-full px-2.5 py-1.5 rounded-md text-xs border bg-background outline-none ${
              canton && canton.distritos.some((d) => normalizeText(d) === normalizeText(order.district))
                ? 'border-emerald-300 dark:border-emerald-700'
                : 'border-amber-300 dark:border-amber-700'
            }`}
          />
          {districtOpen && districtResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 max-h-48 overflow-y-auto rounded-lg border bg-popover shadow-lg mt-0.5">
              {districtResults.map((r) => (
                <button
                  key={`${r.province}-${r.canton}-${r.district}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ province: r.province, canton: r.canton, district: r.district });
                    setCantonSearch(r.canton);
                    setDistrictSearch(r.district);
                    setDistrictOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-accent transition-colors border-b border-border/30 last:border-b-0"
                >
                  <div className="text-xs font-medium">{r.district}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.canton} · {r.province}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dirección */}
      <div>
        <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
          Dirección exacta
        </label>
        <input
          value={order.address}
          onChange={(e) => onChange({ address: e.target.value })}
          placeholder="Señas exactas de dirección"
          className={`w-full px-2.5 py-1.5 rounded-md text-xs border bg-background outline-none ${
            order.address.trim()
              ? 'border-emerald-200 dark:border-emerald-800'
              : 'border-amber-300 dark:border-amber-700'
          }`}
        />
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function GuiaGenerator({ orders, open, onClose, onUpdateOrder }: GuiaGeneratorProps) {
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');
  const [orderGuias, setOrderGuias] = useState<OrderGuiaData[]>([]);
  const [shippingConfigs, setShippingConfigs] = useState<ShippingConfig[]>([]);
  const [hasCorreosConfig, setHasCorreosConfig] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState<string>('correos_cr');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<'manual' | 'automatic'>('manual');
  const [deliveryType, setDeliveryType] = useState<'Domicilio' | 'Sucursal' | 'Punto de correo'>('Domicilio');
  const [guiasHistory, setGuiasHistory] = useState<GuiaStatus[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Verification step
  const [showVerification, setShowVerification] = useState(false);
  const [verifiedOrders, setVerifiedOrders] = useState<VerifiedOrder[]>([]);
  const [generationResults, setGenerationResults] = useState<any>(null);

  useEffect(() => {
    if (open) {
      const eaOrders = orders
        .filter((order) => order.orderType === 'EA')
        .map((order) => ({
          orderId: order.orderId,
          guiaNumber: '',
          selected: false,
          status: 'pending' as const,
        }));
      setOrderGuias(eaOrders);
      setShowVerification(false);
      setGenerationResults(null);
      loadShippingConfigs();
    }
  }, [open]);

  const loadShippingConfigs = async () => {
    try {
      const response = await fetch('/api/config/shipping-config', { credentials: 'include' });

      if (!response.ok) {
        setHasCorreosConfig(false);
        return;
      }

      const result = await response.json();
      if (result.status === 'success') {
        const configs: ShippingConfig[] = result.data || [];
        setShippingConfigs(configs);

        const correosConfig = configs.find(
          (c) => c.carrier.toLowerCase() === 'correos_cr' && c.isActive
        );
        if (correosConfig) {
          setSelectedCarrier(correosConfig.carrier);
        }
        // WS credentials are now platform-level env vars — check via status endpoint
        try {
          const statusRes = await fetch('/api/config/correos-status', { credentials: 'include' });
          const statusData = await statusRes.json();
          setHasCorreosConfig(statusData.configured ?? false);
        } catch {
          setHasCorreosConfig(false);
        }
      }
    } catch {
      setHasCorreosConfig(false);
    }
  };

  const handleToggleOrder = (orderId: string) => {
    setOrderGuias((prev) => prev.map((og) => (og.orderId === orderId ? { ...og, selected: !og.selected } : og)));
  };

  const handleGuiaNumberChange = (orderId: string, value: string) => {
    setOrderGuias((prev) => prev.map((og) => (og.orderId === orderId ? { ...og, guiaNumber: value } : og)));
  };

  const handleSelectAll = () => {
    setOrderGuias((prev) => prev.map((og) => ({ ...og, selected: true })));
  };

  const handleDeselectAll = () => {
    setOrderGuias((prev) => prev.map((og) => ({ ...og, selected: false })));
  };

  // ── Verification step ─────────────────────────────────────

  const openVerification = useCallback(() => {
    const selectedList = orderGuias.filter((og) => og.selected);
    const verified = selectedList.map((og) => {
      const order = orders.find((o) => o.orderId === og.orderId);
      if (!order) return null;
      const prov = findProvince(order.province || '');
      const cant = findCanton(prov, order.canton || '');
      const dist = order.district || '';
      const addr = order.address || '';
      const valid =
        !!prov &&
        !!cant &&
        cant.distritos.some((d) => normalizeText(d) === normalizeText(dist)) &&
        addr.trim().length > 0;
      return {
        orderId: order.orderId,
        customerName: order.customerName || '',
        province: order.province || '',
        canton: order.canton || '',
        district: dist,
        address: addr,
        phone: order.phone || '',
        product: order.product || '',
        quantity: order.quantity ?? 1,
        valid,
      } as VerifiedOrder;
    }).filter(Boolean) as VerifiedOrder[];

    setVerifiedOrders(verified);
    setGenerationResults(null);
    setShowVerification(true);
  }, [orderGuias, orders]);

  const updateVerifiedOrder = (idx: number, updates: Partial<VerifiedOrder>) => {
    setVerifiedOrders((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      const prov = findProvince(next[idx].province);
      const cant = findCanton(prov, next[idx].canton);
      next[idx].valid =
        !!prov &&
        !!cant &&
        cant.distritos.some((d) => normalizeText(d) === normalizeText(next[idx].district)) &&
        next[idx].address.trim().length > 0;
      return next;
    });
  };

  const allValid = verifiedOrders.length > 0 && verifiedOrders.every((o) => o.valid);
  const validCount = verifiedOrders.filter((o) => o.valid).length;

  // ── Generate with verified data ───────────────────────────

  const handleGenerateVerified = async () => {
    if (!allValid) return;
    setIsGenerating(true);
    setGenerationResults(null);

    setOrderGuias((prev) =>
      prev.map((og) => (og.selected ? { ...og, status: 'generating' as const } : og))
    );

    try {
      const response = await fetch('/api/shipping/generate-guia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderIds: verifiedOrders.map((o) => o.orderId),
          carrier: selectedCarrier,
          deliveryType,
          verifiedLocations: verifiedOrders.map((o) => ({
            orderId: o.orderId,
            province: o.province,
            canton: o.canton,
            district: o.district,
            address: o.address,
          })),
        }),
      });

      const result = await response.json();

      if (result.status === 'success') {
        setGenerationResults(result.data);

        setOrderGuias((prev) =>
          prev.map((og) => {
            const orderResult = result.data.results.find((r: any) => r.orderId === og.orderId);
            if (orderResult) {
              return {
                ...og,
                status: orderResult.success ? ('success' as const) : ('error' as const),
                guiaNumber: orderResult.guiaNumber || og.guiaNumber,
                trackingNumber: orderResult.trackingNumber,
                error: orderResult.error,
                pdfDownloaded: orderResult.pdfDownloaded || false,
              };
            }
            return og;
          })
        );

        // The guía API owns the single Enviado transition. Writing it again
        // here caused duplicate audit entries and status races.
      } else {
        setGenerationResults({ error: result.error || 'Error generando guías' });
        setOrderGuias((prev) =>
          prev.map((og) => (og.status === 'generating' ? { ...og, status: 'pending' as const } : og))
        );
      }
    } catch (err: any) {
      setGenerationResults({ error: err.message || 'Error de conexión' });
      setOrderGuias((prev) =>
        prev.map((og) => (og.status === 'generating' ? { ...og, status: 'pending' as const } : og))
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Manual print ──────────────────────────────────────────

  const handlePrint = async () => {
    const selectedOrders = orderGuias.filter((og) => og.selected);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    try {
      const response = await fetch('/api/shipping/guias/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entries: selectedOrders.map(order => ({ orderId: order.orderId, guiaNumber: order.guiaNumber })),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        printWindow.close();
        alert(`❌ ${payload.error || 'No se pudieron guardar las guías manuales'}`);
        return;
      }
    } catch {
      printWindow.close();
      alert('❌ No se pudieron guardar las guías manuales');
      return;
    }

    const orderElements = selectedOrders
      .map((og) => {
        const order = orders.find((o) => o.orderId === og.orderId);
        if (!order) return '';

        return `
        <div class="guia-container page-break">
          <div class="header">
            <h1>Guía de Envío</h1>
            <h2>Número de Guía: ${escapeHtml(og.guiaNumber)}</h2>
          </div>
          <div class="info-row"><span class="info-label">Orden:</span><span class="info-value">${escapeHtml(order.orderId)}</span></div>
          <div class="info-row"><span class="info-label">Teléfono:</span><span class="info-value">${escapeHtml(order.phone || '')}</span></div>
          <div class="info-row"><span class="info-label">Cliente:</span><span class="info-value">${escapeHtml(order.customerName || '')}</span></div>
          <div class="info-row"><span class="info-label">Producto:</span><span class="info-value">${escapeHtml(order.product || '')}</span></div>
          <div class="info-row"><span class="info-label">Cantidad:</span><span class="info-value">${escapeHtml(String(order.quantity ?? ''))}</span></div>
          <div class="info-row"><span class="info-label">Provincia:</span><span class="info-value">${escapeHtml(order.province || 'N/A')}</span></div>
          <div class="info-row"><span class="info-label">Cantón:</span><span class="info-value">${escapeHtml(order.canton || 'N/A')}</span></div>
          <div class="info-row"><span class="info-label">Distrito:</span><span class="info-value">${escapeHtml(order.district || 'N/A')}</span></div>
          <div class="info-row"><span class="info-label">Dirección:</span><span class="info-value">${escapeHtml(order.address || '')}</span></div>
          <div class="info-row"><span class="info-label">Comentarios:</span><span class="info-value">${escapeHtml(order.comments || '')}</span></div>
        </div>`;
      })
      .join('');

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Guías de Envío</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; margin: 0; background: #fff; color: #000; }
        .guia-container { border: 2px solid #000; padding: 20px; margin-bottom: 20px; page-break-inside: avoid; }
        .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
        .info-row { margin: 10px 0; display: flex; justify-content: space-between; }
        .info-label { font-weight: bold; margin-right: 10px; }
        .info-value { flex: 1; }
        .page-break { page-break-after: always; }
        @media print { body { padding: 0; background: #fff !important; color: #000 !important; } .no-print { display: none; } }
      </style></head><body>${orderElements}
      <button class="no-print" onclick="window.print()">Imprimir</button></body></html>`);
    printWindow.document.close();
  };

  // ── History ───────────────────────────────────────────────

  const loadGuiasHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch('/api/shipping/guias/status', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setGuiasHistory(data.data.guias || []);
      }
    } catch {}
    setLoadingHistory(false);
  };

  useEffect(() => {
    if (open && activeTab === 'history') loadGuiasHistory();
  }, [open, activeTab]);

  const downloadPDF = async (guiaId: string, fileName: string) => {
    try {
      const response = await fetch(`/api/shipping/guias/download/${guiaId}`, { credentials: 'include' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch {}
  };

  const canPrint = orderGuias.some((og) => og.selected && og.guiaNumber);
  const selectedCount = orderGuias.filter((og) => og.selected).length;

  // ─────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[95vh] sm:max-h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-2">
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <Truck className="h-5 w-5 text-primary" />
            Guías de Envío
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="px-5 border-b">
          <div className="flex gap-1">
            {[
              { id: 'generate' as const, label: 'Generar', icon: FileText },
              { id: 'history' as const, label: `Historial (${guiasHistory.length})`, icon: Clock },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── GENERATE TAB ──────────────────────────────── */}
        {activeTab === 'generate' && !showVerification && (
          <>
            {/* Mode selector */}
            <div className="px-5 py-3 border-b bg-muted/30">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="generationMode"
                    value="manual"
                    checked={generationMode === 'manual'}
                    onChange={() => setGenerationMode('manual')}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm font-medium">Manual</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="generationMode"
                    value="automatic"
                    checked={generationMode === 'automatic'}
                    onChange={() => setGenerationMode('automatic')}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm font-medium">
                    <span className="hidden sm:inline">Automático (Correos de Costa Rica)</span>
                    <span className="sm:hidden">Automático</span>
                  </span>
                </label>
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                {generationMode === 'manual'
                  ? 'Ingrese manualmente los números de guía para las órdenes seleccionadas.'
                  : 'Genere guías automáticamente con Correos de Costa Rica. Se verificarán las ubicaciones antes de generar.'}
              </p>

              {/* Automatic mode: delivery type + config status */}
              {generationMode === 'automatic' && (
                <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-semibold text-muted-foreground">Tipo de envío:</span>
                    {(['Domicilio', 'Sucursal', 'Punto de correo'] as const).map((dt) => (
                      <label key={dt} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="deliveryType"
                          value={dt}
                          checked={deliveryType === dt}
                          onChange={() => setDeliveryType(dt)}
                          className="w-3.5 h-3.5 accent-primary"
                        />
                        <span className="text-xs">{dt}</span>
                      </label>
                    ))}
                  </div>

                  {!hasCorreosConfig && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2 border border-amber-200 dark:border-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      Configura las credenciales de Correos CR en Configuración → Envíos (Correos CR) antes de generar.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bulk actions */}
            <div className="px-5 py-2 flex items-center justify-between border-b bg-muted/10">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {selectedCount} de {orderGuias.length} seleccionadas
                </span>
                <button onClick={handleSelectAll} className="text-xs text-primary hover:underline">
                  Todas
                </button>
                <button onClick={handleDeselectAll} className="text-xs text-muted-foreground hover:underline">
                  Ninguna
                </button>
              </div>
            </div>

            {/* Order list */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <ScrollArea className="h-[350px] sm:h-[420px] px-5">
                <div className="space-y-2 py-2">
                  {orderGuias.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">No hay órdenes de envío</p>
                      <p className="text-xs mt-1">Solo se muestran órdenes de tipo EA</p>
                    </div>
                  ) : (
                    orderGuias.map((og) => {
                      const order = orders.find((o) => o.orderId === og.orderId);
                      if (!order) return null;

                      return (
                        <div
                          key={og.orderId}
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                            og.selected
                              ? 'border-primary/30 bg-primary/5'
                              : 'border-border bg-card hover:bg-accent/30'
                          }`}
                        >
                          <div className="pt-0.5">
                            <Checkbox
                              checked={og.selected}
                              onCheckedChange={() => handleToggleOrder(og.orderId)}
                              disabled={og.status === 'generating'}
                            />
                          </div>
                          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{og.orderId}</span>
                                {og.status === 'generating' && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                )}
                                {og.status === 'success' && (
                                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                                )}
                                {og.status === 'error' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {order.customerName}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {[order.province, order.canton, order.district].filter(Boolean).join(', ') || 'Sin ubicación'}
                              </p>
                              <p className="text-xs text-muted-foreground">Cant: {order.quantity}</p>
                              {og.error && (
                                <p className="text-xs text-red-500 mt-1">{og.error}</p>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {generationMode === 'manual' && (
                                <Input
                                  placeholder="Número de guía"
                                  value={og.guiaNumber}
                                  onChange={(e) => handleGuiaNumberChange(og.orderId, e.target.value)}
                                  disabled={!og.selected || og.status === 'generating'}
                                  className="text-xs h-8"
                                />
                              )}
                              {og.trackingNumber && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Search className="h-3 w-3" />
                                  Guía: {og.trackingNumber}
                                </div>
                              )}
                              {og.pdfDownloaded && (
                                <div className="flex items-center gap-1 text-xs text-emerald-600">
                                  <FileText className="h-3 w-3" />
                                  PDF disponible
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>

              {/* Footer */}
              <DialogFooter className="px-5 py-3 border-t bg-muted/20 flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={onClose} className="w-full sm:w-auto order-3 sm:order-1">
                  Cancelar
                </Button>

                {generationMode === 'automatic' && (
                  <Button
                    onClick={openVerification}
                    disabled={selectedCount === 0 || !hasCorreosConfig}
                    className="w-full sm:w-auto flex items-center gap-2 order-1 sm:order-2"
                  >
                    <Zap className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      Verificar y Generar ({selectedCount})
                    </span>
                    <span className="sm:hidden">Verificar ({selectedCount})</span>
                  </Button>
                )}

                {generationMode === 'manual' && (
                  <Button
                    onClick={handlePrint}
                    disabled={!canPrint}
                    className="w-full sm:w-auto flex items-center gap-2 order-2 sm:order-3"
                  >
                    <Printer className="h-4 w-4" />
                    <span className="hidden sm:inline">Imprimir Seleccionados</span>
                    <span className="sm:hidden">Imprimir</span>
                  </Button>
                )}
              </DialogFooter>
            </div>
          </>
        )}

        {/* ─── VERIFICATION STEP ─────────────────────────── */}
        {activeTab === 'generate' && showVerification && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {/* Verification header */}
            <div className="px-5 py-3 border-b bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="h-4 w-4 text-emerald-500" />
                  <div>
                    <h3 className="font-semibold text-sm">Verificar Ubicaciones</h3>
                    <p className="text-xs text-muted-foreground">
                      Verifica provincia, cantón y distrito antes de generar.{' '}
                      <span
                        className={
                          allValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                        }
                      >
                        {validCount}/{verifiedOrders.length} verificadas
                      </span>
                    </p>
                  </div>
                </div>
                {!isGenerating && !generationResults && (
                  <Button variant="ghost" size="sm" onClick={() => setShowVerification(false)} className="gap-1.5">
                    <ChevronLeft className="h-4 w-4" />
                    Volver
                  </Button>
                )}
              </div>

              {/* Delivery type */}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs font-semibold text-muted-foreground">Tipo de envío:</span>
                <select
                  value={deliveryType}
                  onChange={(e) => setDeliveryType(e.target.value as typeof deliveryType)}
                  className="px-2.5 py-1 rounded-md text-xs border bg-background outline-none"
                >
                  <option value="Domicilio">Domicilio</option>
                  <option value="Sucursal">Sucursal</option>
                  <option value="Punto de correo">Punto de correo</option>
                </select>
              </div>
            </div>

            {/* Verification list */}
            <ScrollArea className="h-[350px] sm:h-[400px] px-5 py-3">
              {verifiedOrders.map((o, idx) => (
                <LocationRow key={o.orderId} order={o} onChange={(updates) => updateVerifiedOrder(idx, updates)} />
              ))}
            </ScrollArea>

            {/* Generation results */}
            {generationResults && (
              <div className="px-5 py-3 border-t">
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    generationResults.error
                      ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
                      : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20'
                  }`}
                >
                  {generationResults.error ? (
                    <p className="text-red-700 dark:text-red-400">{generationResults.error}</p>
                  ) : (
                    <div>
                      <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-2">
                        {generationResults.successful} exitosa{generationResults.successful !== 1 ? 's' : ''},{' '}
                        {generationResults.failed} fallida{generationResults.failed !== 1 ? 's' : ''}
                      </p>
                      {generationResults.results?.map((r: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 py-0.5 text-xs">
                          {r.success ? (
                            <CheckCircle className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500" />
                          )}
                          <span className="font-medium">{r.orderId}</span>
                          {r.guiaNumber && (
                            <Badge variant="secondary" className="text-[10px] h-5">
                              #{r.guiaNumber}
                            </Badge>
                          )}
                          {r.error && <span className="text-red-500">{r.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Verification footer */}
            <DialogFooter className="px-5 py-3 border-t bg-muted/20 flex-col sm:flex-row gap-2">
              {generationResults ? (
                <Button
                  onClick={() => {
                    setShowVerification(false);
                    setActiveTab('history');
                    loadGuiasHistory();
                  }}
                  className="w-full sm:w-auto flex items-center gap-2"
                >
                  <Clock className="h-4 w-4" />
                  Ver Historial
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowVerification(false)}
                    disabled={isGenerating}
                    className="w-full sm:w-auto order-2 sm:order-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleGenerateVerified}
                    disabled={!allValid || isGenerating}
                    className="w-full sm:w-auto flex items-center gap-2 order-1 sm:order-2"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    {isGenerating
                      ? 'Generando...'
                      : `Confirmar y Generar (${verifiedOrders.length})`}
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        )}

        {/* ─── HISTORY TAB ───────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <ScrollArea className="h-[450px] sm:h-[550px] px-5 py-4">
              {loadingHistory ? (
                <div className="flex justify-center items-center h-48">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : guiasHistory.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">No hay guías generadas</p>
                  <p className="text-xs mt-1">Las guías que generes aparecerán aquí</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {guiasHistory.map((guia) => {
                    const location = [guia.province, guia.canton, guia.district]
                      .filter(Boolean)
                      .join(', ');

                    return (
                      <div
                        key={guia.id}
                        className={`rounded-lg border p-3.5 bg-card hover:bg-accent/20 transition-colors ${
                          guia.status === 'completed'
                            ? 'border-emerald-200/60 dark:border-emerald-800/30'
                            : guia.status === 'failed'
                            ? 'border-red-200/60 dark:border-red-800/30'
                            : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Guia number + status */}
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-bold text-sm tracking-wide">
                                {guia.guiaNumber || 'Sin número'}
                              </span>
                              <Badge
                                variant={
                                  guia.status === 'completed'
                                    ? 'default'
                                    : guia.status === 'failed'
                                    ? 'destructive'
                                    : 'secondary'
                                }
                                className="text-[10px] h-5"
                              >
                                {guia.status === 'completed' ? (
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                ) : guia.status === 'failed' ? (
                                  <XCircle className="h-3 w-3 mr-1" />
                                ) : (
                                  <Clock className="h-3 w-3 mr-1" />
                                )}
                                {guia.status === 'completed'
                                  ? 'Completada'
                                  : guia.status === 'failed'
                                  ? 'Fallida'
                                  : guia.status}
                              </Badge>
                            </div>

                            {/* Customer + product */}
                            {guia.customerName && (
                              <p className="text-sm font-medium truncate">{guia.customerName}</p>
                            )}
                            {guia.product && (
                              <p className="text-xs text-muted-foreground truncate">
                                {guia.product}
                                {guia.quantity && guia.quantity > 1 ? ` (x${guia.quantity})` : ''}
                              </p>
                            )}

                            {/* Location + order details */}
                            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                              {location && (
                                <p className="truncate">{location}</p>
                              )}
                              <div className="flex items-center gap-3 flex-wrap">
                                <span>Orden: {guia.orderId}</span>
                                {guia.phone && <span>Tel: {guia.phone}</span>}
                              </div>
                              {guia.errorMessage && (
                                <p className="text-red-500 mt-0.5">{guia.errorMessage}</p>
                              )}
                              <p className="text-muted-foreground/60">
                                {new Date(guia.createdAt).toLocaleString('es-CR')}
                              </p>
                            </div>
                          </div>

                          <div>
                            {guia.hasPdf ? (
                              <Button
                                onClick={() =>
                                  downloadPDF(guia.id, guia.pdfFileName || `guia-${guia.guiaNumber}.pdf`)
                                }
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                              >
                                <Download className="h-3.5 w-3.5" />
                                PDF
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled
                                className="gap-1.5 text-muted-foreground"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Sin PDF
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* History footer */}
            <div className="px-5 py-3 border-t bg-muted/20 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Total: {guiasHistory.length} guía(s)</p>
              <Button
                onClick={loadGuiasHistory}
                variant="outline"
                size="sm"
                disabled={loadingHistory}
                className="gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                Actualizar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
