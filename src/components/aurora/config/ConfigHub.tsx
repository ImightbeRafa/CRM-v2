'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { AlertCircle, Check, ChevronRight, Globe, Radio, Truck, UsersRound } from 'lucide-react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { AuroraErrorState } from '../states/AuroraErrorState'
import { AuroraListSkeleton } from '../states/AuroraSkeleton'
import { CONFIG_NAV, configTabHref, type ConfigNavGroup, type ConfigTabId } from './config-nav'
import { ConfigCard } from './panels/ConfigCard'
import { ConfigPanelHeader } from './panels/ConfigPanelHeader'
import { useChannelsSummary } from './useChannelsNeedingAction'

type SetupItem = { id: string; label: string; description: string; completed: boolean; href: string }
type SetupStatus = { completedCount: number; totalCount: number; items: SetupItem[] }

const GROUP_META: Record<string, { icon: typeof Globe; subtitle: string }> = {
  Negocio: { icon: Globe, subtitle: 'Identidad, catálogo y datos de clientes' },
  Comunicación: { icon: Radio, subtitle: 'Líneas, agentes e integraciones' },
  Operación: { icon: Truck, subtitle: 'Envíos y manejo de datos' },
  Cuenta: { icon: UsersRound, subtitle: 'Personas, plan y registro' },
}

/** Resumen: readiness from real setup checks + a card per sub-nav group. */
function ReadinessCard({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const { summary } = useChannelsSummary()
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    fetch('/api/dashboard/setup-status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('setup-status'))))
      .then((json: SetupStatus) => !cancelled && setStatus(json))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [nonce])

  if (failed) {
    return (
      <ConfigCard>
        <AuroraErrorState
          title="No pudimos cargar el estado de tu cuenta"
          description="Podés seguir usando los ajustes de abajo."
          onRetry={() => setNonce((n) => n + 1)}
        />
      </ConfigCard>
    )
  }
  if (!status) {
    return (
      <ConfigCard>
        <AuroraListSkeleton rows={3} label="Cargando estado de la cuenta" />
      </ConfigCard>
    )
  }

  const needsAction = summary?.needsAction ?? 0
  const total = status.totalCount
  const pct = total > 0 ? Math.round((status.completedCount / total) * 100) : 0
  const headline =
    pct >= 100 ? 'Tu cuenta está lista' : pct >= 50 ? 'Tu cuenta está casi lista' : 'Terminemos de configurar tu cuenta'
  const missing = total - status.completedCount

  return (
    <section
      data-testid="config-hub-readiness"
      className="grid gap-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[#5B3FE0]/40 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]"
    >
      <div className="flex flex-col justify-center">
        <p className="bg-gradient-to-r from-[#5B6CFF] to-[#DD2A7B] bg-clip-text text-[44px] font-bold leading-none text-transparent">
          {pct}%
        </p>
        <p className="mt-3 text-[16px] font-semibold text-[#0E0D17]">{headline}</p>
        {missing > 0 && (
          <p className="mt-1 text-[13px] text-slate-500">
            Falta{missing === 1 ? '' : 'n'} {missing} {missing === 1 ? 'paso' : 'pasos'} para terminar la configuración base.
          </p>
        )}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-to-r from-[#5B6CFF] to-[#DD2A7B]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="divide-y divide-slate-100 self-center">
        {status.items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="flex items-center gap-3 py-2.5 text-[14px] hover:text-[#5B3FE0]">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  item.completed ? 'bg-emerald-500 text-white' : 'border-2 border-amber-400'
                }`}
                aria-hidden
              >
                {item.completed ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className={`min-w-0 flex-1 ${item.completed ? 'text-slate-600' : 'font-medium text-slate-900'}`}>
                {item.label}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
            </Link>
          </li>
        ))}
        {needsAction > 0 && (
          <li>
            <div className="flex items-center gap-3 py-2.5 text-[14px]">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-amber-400" aria-hidden />
              <span className="min-w-0 flex-1 font-medium text-slate-900">
                {needsAction} {needsAction === 1 ? 'canal requiere' : 'canales requieren'} acción
              </span>
              <button
                type="button"
                onClick={() => onOpenTab('social')}
                className="shrink-0 rounded-lg bg-[#5B3FE0] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#4A32C4]"
              >
                Reparar
              </button>
            </div>
          </li>
        )}
      </ul>
    </section>
  )
}

function GroupCard({
  group,
  hints,
  onOpenTab,
}: {
  group: ConfigNavGroup
  hints: Partial<Record<ConfigTabId, React.ReactNode>>
  onOpenTab: (tab: string) => void
}) {
  const meta = GROUP_META[group.title]
  const Icon = meta?.icon ?? Globe
  return (
    <ConfigCard className="p-5" data-testid={`config-hub-group-${group.title.toLowerCase()}`}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EEFF] text-[#5B3FE0]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[#0E0D17]">{group.title}</h2>
          {meta ? <p className="truncate text-[12px] text-slate-500">{meta.subtitle}</p> : null}
        </div>
      </div>
      <ul>
        {group.items.map((item) => (
          <li key={item.key}>
            <Link
              href={configTabHref(item.tab)}
              scroll={false}
              onClick={(e) => {
                // Same-page navigation through the shell so the optimistic highlight follows.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                onOpenTab(item.tab)
                e.preventDefault()
              }}
              className="flex items-center gap-3 rounded-lg py-2.5 text-[14px] text-slate-800 hover:text-[#5B3FE0]"
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {hints[item.tab] ? <span className="shrink-0 text-[12px] text-slate-500">{hints[item.tab]}</span> : null}
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </ConfigCard>
  )
}

/** Resumen (`/config`): readiness + group shortcuts. Counts appear only where a real API backs them. */
export function ConfigHub({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const { data: session } = useSession()
  const { summary } = useChannelsSummary()
  const canSeeChannels = hasSessionPermission(session, 'update_config')
  const [userCount, setUserCount] = useState<number | null>(null)
  const tenantName = session?.user?.currentTenant?.name?.trim()

  const loadUsers = useCallback(() => {
    let cancelled = false
    fetch('/api/users')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.status === 'success' && Array.isArray(json.data)) setUserCount(json.data.length)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => loadUsers(), [loadUsers])

  const hints: Partial<Record<ConfigTabId, React.ReactNode>> = {}
  if (canSeeChannels && summary) {
    const n = summary.accounts.length
    hints.social =
      summary.needsAction > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
          <AlertCircle className="h-3 w-3" aria-hidden />
          {summary.needsAction} {summary.needsAction === 1 ? 'requiere' : 'requieren'} acción
        </span>
      ) : (
        `${n} ${n === 1 ? 'canal' : 'canales'}`
      )
  }
  if (userCount !== null) hints.users = `${userCount} ${userCount === 1 ? 'persona' : 'personas'}`

  return (
    <div data-testid="config-hub">
      <ConfigPanelHeader
        title="Configuración"
        subtitle={tenantName ? `Estado de tu cuenta y acceso a cada ajuste de ${tenantName}` : 'Estado de tu cuenta y acceso a cada ajuste'}
      />
      <div className="space-y-4">
        <ReadinessCard onOpenTab={onOpenTab} />
        <div className="grid gap-4 md:grid-cols-2">
          {CONFIG_NAV.map((group) => (
            <GroupCard
              key={group.title}
              group={{
                ...group,
                items: group.items.filter(
                  (i) => !i.permission || !session || hasSessionPermission(session, i.permission),
                ),
              }}
              hints={hints}
              onOpenTab={onOpenTab}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
