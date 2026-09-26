'use client'

import Link from 'next/link'
import { CheckCircle2, ChevronRight } from 'lucide-react'
import { ALERTS_EMPTY_LABEL, type AuroraAlert } from '@/lib/aurora-alerts'

/** Read-only list of derived alerts; empty state "Todo al día". Shared by the bell and the mobile Más sheet. */
export function AuroraAlertsList({ alerts, onNavigate }: { alerts: AuroraAlert[]; onNavigate?: () => void }) {
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center" data-testid="aurora-alerts-empty">
        <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-[14px] font-semibold text-slate-900">{ALERTS_EMPTY_LABEL}</p>
        <p className="mt-0.5 text-[12px] text-slate-500">No hay nada pendiente por ahora.</p>
      </div>
    )
  }
  return (
    <ul className="divide-y divide-slate-100" data-testid="aurora-alerts-list">
      {alerts.map((alert) => (
        <li key={alert.key}>
          <Link
            href={alert.href}
            onClick={onNavigate}
            className="flex items-center gap-3 px-4 py-3 text-[13px] text-slate-800 transition-colors hover:bg-slate-50"
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${alert.tone === 'warn' ? 'bg-amber-500' : 'bg-[#5B6CFF]'}`}
            />
            <span className="min-w-0 flex-1">{alert.title}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}
