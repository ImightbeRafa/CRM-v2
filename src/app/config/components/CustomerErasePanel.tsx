'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';

type Preview = {
  name: string;
  counts: { orders: number; conversations: number; messages: number; notes: number; tasks: number };
  openOrders: string[];
  confirmToken: string | null;
};

async function post(clientId: string, body: unknown) {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/data-erase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, json };
}

/**
 * Owner-only "remove this customer's personal data" (Ley 8968), kept low-key on purpose: a small
 * link that opens a short confirmation. Invoices and logistics records are not touched.
 */
export function CustomerErasePanel({ clientId, onErased }: { clientId: string; onErased: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setOpen(true);
    setBusy(true);
    setError('');
    const { ok, json } = await post(clientId, { step: 'preview' });
    setBusy(false);
    if (!ok) return setError(json.error || 'No se pudo revisar este cliente.');
    setPreview(json as Preview);
  };

  const erase = async () => {
    if (!preview?.confirmToken) return;
    setBusy(true);
    setError('');
    const { ok, json } = await post(clientId, { confirmToken: preview.confirmToken, typedName: typed });
    setBusy(false);
    if (!ok) return setError(json.error || 'No se pudo completar.');
    onErased();
  };

  if (!open) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => void start()}>
        Eliminar datos personales
      </button>
    );
  }

  return (
    <div className="rounded-lg border p-3 space-y-3 text-sm" data-testid="customer-erase-panel">
      {busy && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {preview && preview.openOrders.length > 0 ? (
        <p>
          Este cliente tiene pedidos en curso ({preview.openOrders.slice(0, 5).join(', ')}
          {preview.openOrders.length > 5 ? '…' : ''}). Cuando estén cerrados podés eliminar sus datos.
        </p>
      ) : null}
      {preview && preview.confirmToken ? (
        <>
          <p className="text-muted-foreground">
            Se quitan su nombre y datos de contacto de los pedidos, y se borran sus chats y notas. Las facturas se
            conservan.
          </p>
          <p className="text-xs text-muted-foreground">
            {preview.counts.orders} pedidos · {preview.counts.conversations} chats · {preview.counts.messages} mensajes ·{' '}
            {preview.counts.notes} notas
          </p>
          <label className="block text-xs">
            Escribí <strong>{preview.name}</strong> para confirmar
            <Input className="mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        </>
      ) : null}
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setOpen(false); setPreview(null); setTyped(''); setError(''); }}>
          Cancelar
        </Button>
        {preview?.confirmToken ? (
          <Button type="button" size="sm" className="bg-red-600 text-white hover:bg-red-700" disabled={busy || !typed.trim()} onClick={() => void erase()}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Eliminar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
