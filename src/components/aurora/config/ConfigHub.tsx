'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowUpRight, CreditCard, Plus, Truck, Users } from 'lucide-react'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import { classifyChannelHealth, formatRelativeEs, isOwnerChannel, type ChannelHealthTone } from '@/app/config/social/channel-health'
import type { SocialAccount } from '@/app/config/social/types'
import { formatInstagramHandle, resolveChannelDisplayName } from '@/lib/social-account-identity'

const TONE_CLASS: Record<ChannelHealthTone, string> = {
  ok: 'bg-emerald-50 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
}

const MAX_CHANNEL_ROWS = 6
const MAX_TEAM_ROWS = 4

type TeamUser = { id: string; username: string; email: string; role: string; active: boolean }

const ROLE_LABEL: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', MASTER: 'Master' }

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.charAt(0) + role.slice(1).toLowerCase()
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '·'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function channelName(acc: SocialAccount): string {
  return resolveChannelDisplayName({
    id: acc.id,
    platform: acc.platform,
    accountId: acc.accountId,
    displayName: acc.displayName,
    providerDisplayName: acc.providerDisplayName,
    providerUsername: acc.providerUsername,
    displayPhoneNumber: acc.displayPhoneNumber,
    phoneNumberId: acc.phoneNumberId,
  })
}

function channelSecondary(acc: SocialAccount): string {
  if (acc.platform === 'instagram') return formatInstagramHandle(acc.providerUsername) || 'Instagram Business'
  return acc.displayPhoneNumber?.trim() || 'WhatsApp'
}

const card = 'rounded-2xl border border-slate-200/70 bg-white shadow-sm'

function ChannelsCard() {
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/chat/accounts?includeInactive=1')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.success) setAccounts((json.accounts as SocialAccount[]).filter(isOwnerChannel))
        else setFailed(true)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  const rows = accounts ?? []
  // Problem rows first so the summary surfaces what needs action.
  const sorted = [...rows].sort(
    (a, b) => Number(classifyChannelHealth(b).needsAction) - Number(classifyChannelHealth(a).needsAction),
  )
  const shown = sorted.slice(0, MAX_CHANNEL_ROWS)
  const needsAction = rows.filter((a) => classifyChannelHealth(a).needsAction).length

  return (
    <section className={`${card} p-5`} data-testid="config-hub-channels">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">Cuentas conectadas</h2>
          <p className="text-[12px] text-slate-500">
            {accounts
              ? `${rows.length} ${rows.length === 1 ? 'canal' : 'canales'} · cada número de WhatsApp es un canal independiente${
                  needsAction ? ` · ${needsAction} requieren acción` : ''
                }`
              : 'Cada número de WhatsApp es un canal independiente'}
          </p>
        </div>
        <Link
          href="/config/social"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Agregar línea
        </Link>
      </div>

      {accounts === null && !failed ? (
        <p className="rounded-xl border border-slate-100 px-4 py-6 text-center text-sm text-slate-400">Cargando canales…</p>
      ) : failed ? (
        <p className="rounded-xl border border-slate-100 px-4 py-6 text-center text-sm text-slate-500">
          No pudimos cargar los canales. Abrilos en Canales.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-slate-100 px-4 py-6 text-center text-sm text-slate-500">
          Todavía no hay canales conectados.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
          {shown.map((acc) => {
            const health = classifyChannelHealth(acc)
            const bad = health.tone === 'bad'
            return (
              <li
                key={acc.id}
                data-testid="config-hub-channel-row"
                className={`flex items-center gap-3 px-4 py-3 ${bad ? 'bg-red-50/40' : ''}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    acc.platform === 'instagram'
                      ? 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]'
                      : 'bg-emerald-50'
                  }`}
                >
                  <ChannelLogo
                    platform={acc.platform}
                    size={16}
                    className={acc.platform === 'instagram' ? 'brightness-0 invert' : ''}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{channelName(acc)}</p>
                  <p className="truncate text-[12px] text-slate-500">{channelSecondary(acc)}</p>
                </div>
                <span className={`hidden rounded-md px-2 py-1 text-[12px] font-medium sm:inline-flex ${TONE_CLASS[health.tone]}`}>
                  {health.label}
                </span>
                <span className={`hidden w-20 text-right text-[12px] md:block ${bad ? 'text-red-600' : 'text-slate-400'}`}>
                  {formatRelativeEs(acc.lastWebhookAt) ?? '—'}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <Link
        href="/config/social"
        className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-[#6D4AE8] hover:underline"
      >
        Ver todo en Canales
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  )
}

function TeamCard({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const [users, setUsers] = useState<TeamUser[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/users')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setUsers(json.status === 'success' ? (json.data as TeamUser[]) : [])
      })
      .catch(() => !cancelled && setUsers([]))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className={`${card} p-5`} data-testid="config-hub-team">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">Equipo</h2>
          <p className="text-[12px] text-slate-500">
            {users ? `${users.length} ${users.length === 1 ? 'usuario' : 'usuarios'}` : 'Cargando…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenTab('users')}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          Gestionar
        </button>
      </div>
      {users && users.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">Sin usuarios para mostrar.</p>
      ) : (
        <ul className="space-y-3">
          {(users ?? []).slice(0, MAX_TEAM_ROWS).map((u) => (
            <li key={u.id} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-[11px] font-bold text-white">
                {initials(u.username)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-900">{u.username}</p>
                <p className="truncate text-[12px] text-slate-500">{u.active ? u.email : 'Inactivo'}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                {roleLabel(u.role)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PlanCard({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  return (
    <section
      className="flex flex-col justify-between rounded-2xl bg-[#0E0B16] p-5 text-white shadow-sm ring-1 ring-[#A855F7]/40"
      data-testid="config-hub-plan"
    >
      <div>
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B6CFF] to-[#A855F7]">
            <CreditCard className="h-4 w-4" aria-hidden />
          </span>
          <h2 className="text-[16px] font-semibold">Plan y facturación</h2>
        </div>
        <p className="text-[13px] leading-relaxed text-white/60">
          Revisá tu suscripción, métodos de pago y facturas del negocio.
        </p>
      </div>
      <button
        type="button"
        onClick={() => onOpenTab('billing')}
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-[10px] bg-white/10 px-4 py-2.5 text-[13px] font-medium hover:bg-white/15"
      >
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        Gestionar plan
      </button>
    </section>
  )
}

function PaymentsCard({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const rows = [
    { key: 'shipping', icon: Truck, title: 'Correos de Costa Rica', sub: 'Guías y credenciales de envío', tab: 'shipping-config' },
    { key: 'billing', icon: CreditCard, title: 'Suscripción y cobros', sub: 'Plan, pagos y facturas', tab: 'billing' },
  ]
  return (
    <section className={`${card} p-5`} data-testid="config-hub-payments">
      <h2 className="text-[16px] font-semibold text-slate-900">Pagos y envíos</h2>
      <p className="mb-4 text-[12px] text-slate-500">Cómo cobrás y despachás tus pedidos</p>
      <ul className="space-y-3">
        {rows.map((r) => {
          const Icon = r.icon
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onOpenTab(r.tab)}
                className="flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-slate-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EEFF] text-[#6D4AE8]">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">{r.title}</span>
                  <span className="block truncate text-[12px] text-slate-500">{r.sub}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** CFG-01: connected accounts summary, team, plan and payments/shipping shortcuts. */
export function ConfigHub({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  return (
    <div className="space-y-4" data-testid="config-hub">
      <ChannelsCard />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TeamCard onOpenTab={onOpenTab} />
        <PlanCard onOpenTab={onOpenTab} />
      </div>
      <PaymentsCard onOpenTab={onOpenTab} />
    </div>
  )
}
