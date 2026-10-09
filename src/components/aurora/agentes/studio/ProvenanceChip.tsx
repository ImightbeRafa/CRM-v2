'use client'

import { useState } from 'react'

/** "De dónde salió": the source name, and on click the literal quote the AI used. */
export function ProvenanceChip({ label, snippet }: { label: string | null; snippet: string | null }) {
  const [open, setOpen] = useState(false)
  if (!label) return null
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
        aria-expanded={open}
      >
        <span aria-hidden>📎</span>
        <span className="truncate">{label}</span>
      </button>
      {open && snippet ? (
        <span className="mt-1 max-w-[320px] rounded-lg bg-amber-50 px-2 py-1 text-[11px] italic leading-snug text-amber-900 ring-1 ring-amber-100">
          “{snippet}”
        </span>
      ) : null}
    </span>
  )
}
