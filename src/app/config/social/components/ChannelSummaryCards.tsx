import { AlertTriangle, Radio, ShieldCheck } from 'lucide-react'
import type { ChannelSummary } from '../channel-health'

function pluralize(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function Card({
  icon,
  iconClass,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  iconClass: string
  label: string
  value: number
  hint: string
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-slate-200/70 bg-white px-5 py-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] text-slate-500">{label}</p>
        <p className="flex items-baseline gap-2">
          <span className="text-[22px] font-semibold leading-tight text-slate-900">{value}</span>
          <span className="truncate text-[11px] text-slate-400">{hint}</span>
        </p>
      </div>
    </div>
  )
}

export function ChannelSummaryCards({ summary }: { summary: ChannelSummary }) {
  const actionHint =
    summary.needsAction === 0
      ? 'Todo en orden'
      : [
          summary.webhookDown > 0 ? `${summary.webhookDown} sin webhook` : null,
          summary.tokenIssues > 0 ? pluralize(summary.tokenIssues, 'token', 'tokens') : null,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className="grid gap-3 md:grid-cols-3" data-testid="channel-summary-cards">
      <Card
        icon={<Radio className="h-5 w-5 text-[#5B6CFF]" aria-hidden />}
        iconClass="bg-[#EEF0FF]"
        label="Canales conectados"
        value={summary.connected}
        hint={`${summary.connectedWhatsApp} WhatsApp · ${summary.connectedInstagram} Instagram`}
      />
      <Card
        icon={<ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />}
        iconClass="bg-emerald-50"
        label="Saludables"
        value={summary.healthy}
        hint="Token y webhook al día"
      />
      <Card
        icon={<AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />}
        iconClass="bg-amber-50"
        label="Requieren acción"
        value={summary.needsAction}
        hint={actionHint}
      />
    </div>
  )
}
