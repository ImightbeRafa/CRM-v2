'use client'

import { useMemo, useState } from 'react'
import { ProvenanceChip } from './ProvenanceChip'
import type { Draft, Extracted, InventoryOption } from './studio-types'

type Keep<T> = T & { keep: boolean }

const BRAND_FIELDS: Array<{ key: keyof Extracted['brand']; label: string; apply: boolean }> = [
  { key: 'storeName', label: 'Nombre de la tienda', apply: true },
  { key: 'website', label: 'Sitio web', apply: true },
  { key: 'address', label: 'Dirección', apply: true },
  { key: 'hours', label: 'Horario', apply: true },
  { key: 'pickupText', label: 'Retiro en tienda', apply: true },
  { key: 'whatWeSell', label: 'Qué vende', apply: false },
]

const money = (n: number | null) => (n == null ? '—' : `₡${Math.round(n).toLocaleString('es-CR')}`)

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="rounded-xl ring-1 ring-slate-200/70">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-left" aria-expanded={open}>
        <span className="text-[13px] font-semibold text-slate-900">
          {title}
          {typeof count === 'number' ? <span className="ml-1.5 text-[12px] font-normal text-slate-500">({count})</span> : null}
        </span>
        <span aria-hidden className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open ? <div className="space-y-2 border-t border-slate-100 px-3 py-3">{children}</div> : null}
    </section>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="mt-1 h-4 w-4 shrink-0 accent-[#5B6CFF]" />
  )
}

const INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]'

/** Phone / account / link inside imported text: could be planted by someone else (reviews, comments). */
export function hasContactLike(text: string | null | undefined): boolean {
  return /\d{4}[\s.-]?\d{4}|https?:\/\/|www\.|\bCR\d{2}\s?\d{4}/i.test(text || '')
}
function ContactWarning({ show }: { show: boolean }) {
  return show ? <p className="text-[11px] text-amber-700">Tiene un número o un enlace: revisá que sea tuyo antes de marcarlo.</p> : null
}

/** Step 2: the owner checks every finding (with where it came from), edits, unticks, then applies. */
export function ReviewStep({
  agentId,
  draft,
  inventory,
  canEdit,
  isLive = false,
  current,
  onDiscard,
  onApplied,
}: {
  agentId: string
  current?: { sinpe: string | null; iban: string | null; website: string | null } | null
  draft: Draft
  inventory: InventoryOption[]
  canEdit: boolean
  isLive?: boolean
  onDiscard?: () => void
  onApplied: (summary: string) => void
}) {
  const p = draft.profile!
  const x = p.extracted
  const labelOf = useMemo(() => new Map(p.sources.map((s) => [s.id, s.label])), [p.sources])
  const src = (id: string | null) => (id ? labelOf.get(id) ?? null : null)

  const [brand, setBrand] = useState(() =>
    Object.fromEntries(BRAND_FIELDS.map((f) => [f.key, { keep: f.apply && Boolean(x.brand[f.key].value), value: x.brand[f.key].value || '' }])) as Record<string, { keep: boolean; value: string }>,
  )
  // Payment accounts are NEVER pre-ticked and sharing starts off: the owner confirms each number themselves.
  const [accounts, setAccounts] = useState<Array<Keep<Extracted['paymentAccounts'][number]>>>(() => x.paymentAccounts.map((a) => ({ ...a, keep: false })))
  const [share, setShare] = useState(false)
  const [shipping, setShipping] = useState(() => x.shipping.map((s) => ({ ...s, keep: true })))
  const [policies, setPolicies] = useState(() => x.policies.map((s) => ({ ...s, keep: !hasContactLike(s.text) })))
  const [faq, setFaq] = useState(() => x.faq.map((s) => ({ ...s, keep: !hasContactLike(`${s.question} ${s.answer}`) })))
  const [replies, setReplies] = useState(() => x.quickReplies.map((s) => ({ ...s, keep: !hasContactLike(s.body) })))
  const [rulesEdited, setRulesEdited] = useState(false)
  const [rules, setRules] = useState({
    voice: x.voice.description || '',
    closing: x.howISell.closing || '',
    upsells: x.howISell.upsells || '',
    objections: x.howISell.objections || '',
    handoffWhen: x.howISell.handoffWhen || '',
    mustSay: x.mustSay.join('\n'),
    neverSay: x.neverSay.join('\n'),
  })
  const [products, setProducts] = useState(() =>
    x.products.map((pr, i) => {
      const m = p.matches.find((mm) => mm.index === i)
      return { ...pr, itemId: m?.itemId ?? '', keep: Boolean(m?.itemId), priceDiffers: Boolean(m?.priceDiffers), priceInInventory: m?.priceInInventory ?? null }
    }),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invById = useMemo(() => new Map(inventory.map((i) => [i.id, i])), [inventory])
  const setAt = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((v, j) => (j === i ? { ...v, ...patch } : v))

  async function apply() {
    setBusy(true)
    setError(null)
    const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
    const sinpe = accounts.find((a) => a.keep && a.kind === 'sinpe' && a.number)
    const iban = accounts.find((a) => a.keep && a.kind === 'iban' && a.number)
    const brandSel = Object.fromEntries(
      Object.entries(brand)
        .filter(([, v]) => v.keep && v.value.trim())
        .map(([k, v]) => [k, v.value.trim()]),
    )
    const selection = {
      brand: brandSel,
      payment: sinpe || iban ? { shareWithCustomers: share, sinpe: sinpe ? { number: sinpe.number!, holderName: sinpe.holderName } : null, transfer: iban ? { iban: iban.number, bank: iban.bank, holderName: iban.holderName } : null } : undefined,
      policies: [
        ...shipping
          .filter((s) => s.keep)
          .filter((s) => s.etaText || s.coverageText || s.contraEntrega)
          .map((s) => ({
            title: `Envío${s.methodName ? `: ${s.methodName}` : ''}`,
            // No amounts: the shipping price is always computed by Betsy from the business's shipping methods.
            text: [s.etaText && `Tiempo: ${s.etaText}`, s.coverageText && `Cobertura: ${s.coverageText}`, s.contraEntrega ? 'Acepta contra entrega' : '']
              .filter(Boolean)
              .join('. '),
          })),
        ...policies.filter((s) => s.keep && s.text).map((s) => ({ title: s.title || 'Política', text: s.text! })),
      ],
      faq: faq.filter((s) => s.keep && s.question && s.answer).map((s) => ({ question: s.question!, answer: s.answer! })),
      quickReplies: replies.filter((s) => s.keep && s.title && s.body).map((s) => ({ title: s.title!, body: s.body! })),
      inventoryItemIds: [...new Set(products.filter((s) => s.keep && s.itemId).map((s) => s.itemId))],
      // The selling script is only saved when the owner touched it (AI suggestions never go in unreviewed).
      salesRules: rulesEdited ? { ...rules, mustSay: lines(rules.mustSay), neverSay: lines(rules.neverSay) } : undefined,
    }
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/studio/draft/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.id, selection }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; result?: { knowledge: string[]; shortcuts: number; inventory: number | null; skipped: string[] } }
      if (!res.ok || !json.result) {
        setError(json.error || 'No se pudo aplicar.')
        return
      }
      const r = json.result
      onApplied(
        [
          'Listo.',
          r.inventory != null ? `${r.inventory} productos para vender.` : '',
          r.knowledge.length ? `${r.knowledge.length} documento(s) de conocimiento.` : '',
          r.shortcuts ? `${r.shortcuts} respuestas rápidas.` : '',
          r.skipped.length ? `Algunas cosas no se pudieron guardar (${r.skipped.length}).` : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3" data-testid="studio-review">
      {p.dropped.facts + p.dropped.products > 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600 ring-1 ring-slate-200/70">
          Descartamos {p.dropped.facts + p.dropped.products} dato(s) que no se pudieron comprobar en tus fuentes.
        </p>
      ) : null}

      <Section title="Datos de la tienda">
        {BRAND_FIELDS.filter((f) => x.brand[f.key].value).map((f) => (
          <div key={f.key} className="flex items-start gap-2">
            {f.apply ? <Check checked={brand[f.key].keep} onChange={(v) => setBrand({ ...brand, [f.key]: { ...brand[f.key], keep: v } })} label={f.label} /> : <span className="w-4" />}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[11px] font-medium text-slate-500">{f.label}</p>
              <input className={INPUT} value={brand[f.key].value} disabled={!f.apply} onChange={(e) => setBrand({ ...brand, [f.key]: { ...brand[f.key], value: e.target.value } })} />
              <ProvenanceChip label={src(x.brand[f.key].sourceId)} snippet={x.brand[f.key].snippet} />
            </div>
          </div>
        ))}
      </Section>

      {accounts.length ? (
        <Section title="Cómo te pagan" count={accounts.length}>
          {accounts.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check checked={a.keep} onChange={(v) => setAccounts(setAt(accounts, i, { keep: v }))} label="Usar esta cuenta" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-[13px] font-medium text-slate-800">
                  {a.kind === 'sinpe' ? 'SINPE Móvil' : a.kind === 'iban' ? 'Transferencia (IBAN)' : 'Otra'} · {a.number}
                  {a.holderName ? <span className="font-normal text-slate-500"> · {a.holderName}</span> : null}
                </p>
                {a.confirm ? <p className="text-[11px] text-amber-700">Revisá este número: no aparece igual en la fuente.</p> : null}
                {current?.[a.kind === 'iban' ? 'iban' : 'sinpe'] ? (
                  <p className="text-[11px] text-slate-600">Ahora el agente usa: {current[a.kind === 'iban' ? 'iban' : 'sinpe']}</p>
                ) : null}
                <ProvenanceChip label={src(a.sourceId)} snippet={a.snippet} />
              </div>
            </div>
          ))}
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="h-4 w-4 accent-[#5B6CFF]" />
            El agente puede dar estos datos de pago a los clientes
          </label>
        </Section>
      ) : null}

      {shipping.length ? (
        <Section title="Envíos que encontramos" count={shipping.length}>
          <p className="text-[11px] text-slate-500">Se guardan como información para el agente. El precio del envío siempre lo calcula Betsy con tus métodos de envío.</p>
          {shipping.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check checked={s.keep} onChange={(v) => setShipping(setAt(shipping, i, { keep: v }))} label="Guardar" />
              <div className="min-w-0 flex-1 text-[12px] text-slate-700">
                <p className="font-medium text-slate-800">{s.methodName || 'Envío'}</p>
                <p>{[s.priceText, s.etaText, s.coverageText, s.contraEntrega ? 'contra entrega' : ''].filter(Boolean).join(' · ')}</p>
                <ProvenanceChip label={src(s.sourceId)} snippet={s.snippet} />
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      {products.length ? (
        <Section title="Productos" count={products.length}>
          <p className="text-[11px] text-slate-500">Cada producto se une a tu inventario. Precio y stock salen siempre del inventario.</p>
          {products.map((pr, i) => {
            const item = pr.itemId ? invById.get(pr.itemId) : null
            return (
              <div key={i} className="flex items-start gap-2">
                <Check checked={pr.keep} onChange={(v) => setProducts(setAt(products, i, { keep: v }))} label="Vender este producto" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[13px] text-slate-800">
                    {pr.nameAsSeen}
                    {pr.variantText ? <span className="text-slate-500"> · {pr.variantText}</span> : null}
                    {pr.priceSeen ? <span className="text-slate-500"> · visto a {money(pr.priceSeen)}</span> : null}
                  </p>
                  <select className={INPUT} value={pr.itemId} onChange={(e) => setProducts(setAt(products, i, { itemId: e.target.value, keep: Boolean(e.target.value) }))}>
                    <option value="">— No está en el inventario —</option>
                    {inventory.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                        {o.sku ? ` (${o.sku})` : ''} · {money(o.sellingPrice)} · stock {o.currentStock}
                      </option>
                    ))}
                  </select>
                  {item && pr.priceSeen && Math.abs(pr.priceSeen - item.sellingPrice) >= 1 ? (
                    <p className="text-[11px] text-amber-700">
                      En la fuente dice {money(pr.priceSeen)}; en tu inventario {money(item.sellingPrice)}. El agente usa el del inventario.
                    </p>
                  ) : null}
                  <ProvenanceChip label={src(pr.sourceId)} snippet={pr.snippet} />
                </div>
              </div>
            )
          })}
        </Section>
      ) : null}

      {policies.length ? (
        <Section title="Políticas" count={policies.length}>
          {policies.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check checked={s.keep} onChange={(v) => setPolicies(setAt(policies, i, { keep: v }))} label="Guardar" />
              <div className="min-w-0 flex-1 space-y-1">
                <input className={INPUT} value={s.title || ''} onChange={(e) => setPolicies(setAt(policies, i, { title: e.target.value }))} />
                <textarea className={INPUT} rows={3} value={s.text || ''} onChange={(e) => setPolicies(setAt(policies, i, { text: e.target.value }))} />
                <ContactWarning show={hasContactLike(s.text)} />
                <ProvenanceChip label={src(s.sourceId)} snippet={s.snippet} />
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      {faq.length ? (
        <Section title="Preguntas frecuentes" count={faq.length}>
          {faq.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check checked={s.keep} onChange={(v) => setFaq(setAt(faq, i, { keep: v }))} label="Guardar" />
              <div className="min-w-0 flex-1 space-y-1">
                <input className={INPUT} value={s.question || ''} onChange={(e) => setFaq(setAt(faq, i, { question: e.target.value }))} />
                <textarea className={INPUT} rows={2} value={s.answer || ''} onChange={(e) => setFaq(setAt(faq, i, { answer: e.target.value }))} />
                <ContactWarning show={hasContactLike(`${s.question} ${s.answer}`)} />
                <ProvenanceChip label={src(s.sourceId)} snippet={s.snippet} />
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      <Section title="Cómo vende (sugerido, editalo)">
        {(
          [
            ['voice', 'Tono'],
            ['closing', 'Cómo cierra la venta'],
            ['upsells', 'Qué ofrece además'],
            ['objections', 'Cómo responde objeciones'],
            ['handoffWhen', 'Cuándo pasa a una persona'],
            ['mustSay', 'Siempre (una por línea)'],
            ['neverSay', 'Nunca (una por línea)'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-500">{label}</span>
            <textarea className={INPUT} rows={2} value={rules[k]} onChange={(e) => {
                setRules({ ...rules, [k]: e.target.value })
                setRulesEdited(true)
              }} />
          </label>
        ))}
      </Section>

      {replies.length ? (
        <Section title="Respuestas rápidas" count={replies.length}>
          {replies.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check checked={s.keep} onChange={(v) => setReplies(setAt(replies, i, { keep: v }))} label="Guardar" />
              <div className="min-w-0 flex-1 space-y-1">
                <input className={INPUT} value={s.title || ''} onChange={(e) => setReplies(setAt(replies, i, { title: e.target.value }))} />
                <textarea className={INPUT} rows={2} value={s.body || ''} onChange={(e) => setReplies(setAt(replies, i, { body: e.target.value }))} />
                <ContactWarning show={hasContactLike(s.body)} />
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800 ring-1 ring-rose-100">{error}</p> : null}
      {canEdit && isLive ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-100">
          Este agente ya está respondiendo clientes: lo que apliques cambia sus respuestas de inmediato.
        </p>
      ) : null}
      {canEdit && onDiscard ? (
        <button type="button" disabled={busy} onClick={onDiscard} className="w-full text-center text-[12px] text-slate-500 hover:text-rose-600">
          Descartar este borrador y volver a las fuentes
        </button>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void apply()}
          className="min-h-[44px] w-full rounded-xl bg-[#5B6CFF] px-4 text-[14px] font-semibold text-white disabled:opacity-50"
          data-testid="studio-apply"
        >
          {busy ? 'Aplicando…' : 'Aplicar al agente'}
        </button>
      ) : null}
    </div>
  )
}
