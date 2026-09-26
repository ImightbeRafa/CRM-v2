'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { accountChannelAddress, accountDisplayLabel, type SoftSocialAccount } from '@/lib/chat-soft-copilot'
import {
  filterLineAccounts,
  lineHealth,
  lineIsDown,
  type LineCounts,
} from '@/lib/chat-line-filter'
import { ChannelLogo } from '@/components/social/ChannelLogo'

interface AuroraLineFilterProps {
  accounts: SoftSocialAccount[]
  /** `all` or a concrete SocialAccount.id. */
  selectedAccountId: string | 'all'
  onSelect: (id: string | 'all') => void
  totalOpen: number
  countsByAccount: Map<string, LineCounts>
  /** `card` = CHAT-M01 mobile tenant/line card; default is the desktop pill. */
  variant?: 'pill' | 'card'
}

function CountPill({ value, active }: { value: number; active?: boolean }) {
  return (
    <span
      className={`ml-auto flex h-[18px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
        active ? 'bg-[#5B6CFF] text-white' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {value}
    </span>
  )
}

/** CHAT-02 · line dropdown: "Todas las líneas" + one row per WhatsApp / Instagram SocialAccount. */
export function AuroraLineFilter({
  accounts,
  selectedAccountId,
  onSelect,
  totalOpen,
  countsByAccount,
  variant = 'pill',
}: AuroraLineFilterProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = selectedAccountId === 'all' ? null : accounts.find((a) => a.id === selectedAccountId) ?? null
  const visible = useMemo(() => filterLineAccounts(accounts, query), [accounts, query])
  const groups = useMemo(
    () => [
      { key: 'whatsapp', label: 'WhatsApp', items: visible.filter((a) => a.platform === 'whatsapp') },
      { key: 'instagram', label: 'Instagram', items: visible.filter((a) => a.platform === 'instagram') },
      {
        key: 'other',
        label: 'Otras',
        items: visible.filter((a) => a.platform !== 'whatsapp' && a.platform !== 'instagram'),
      },
    ],
    [visible],
  )

  function pick(id: string | 'all') {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  const selectedDown = selected ? lineIsDown(selected) : false
  const selectedOpen = selected ? countsByAccount.get(selected.id)?.open ?? 0 : totalOpen

  return (
    <div ref={rootRef} className="relative" data-testid="aurora-line-filter">
      {variant === 'card' ? (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-2xl bg-[#F1EEFF] px-3.5 py-2.5 text-left ring-1 ring-[#A48BFF]/40"
        >
          {selected ? (
            <ChannelLogo platform={selected.platform} size={22} className="shrink-0" />
          ) : (
            <span aria-hidden className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-slate-400">
              ◌
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-[#3B2A9E]">
              {selected ? accountDisplayLabel(selected) : 'Todas las líneas'}
            </span>
            <span className="block truncate text-[11px] text-slate-500">
              {[selected ? accountChannelAddress(selected) : null, `${selectedOpen} abiertos`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {selectedDown ? (
            <span aria-label="Línea caída" className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
          ) : null}
          <ChevronDown className="h-4 w-4 shrink-0 text-[#5B3FE0]" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-[12px] font-medium ring-1 transition-colors ${
            selected
              ? 'bg-[#EEF0FF] text-[#4A46E5] ring-[#5B6CFF]/25'
              : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          {selected ? (
            <ChannelLogo platform={selected.platform} size={14} className="shrink-0" />
          ) : (
            <span aria-hidden className="text-slate-400">
              ◌
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">
            {selected ? accountDisplayLabel(selected) : 'Todas las líneas'}
          </span>
          {selectedDown ? (
            <span aria-label="Línea caída" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
          ) : null}
          <span aria-hidden className="text-[10px] text-slate-400">
            ▾
          </span>
        </button>
      )}

      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[min(420px,60dvh)] overflow-y-auto rounded-2xl bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.14)] ring-1 ring-slate-200"
          role="listbox"
          aria-label="Filtrar por línea"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar línea o número"
            className="mb-1.5 w-full rounded-xl border-0 bg-slate-50 px-3 py-2 text-[12px] text-slate-800 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5B6CFF]/30"
          />

          {query.trim() === '' ? (
            <button
              type="button"
              role="option"
              aria-selected={selectedAccountId === 'all'}
              onClick={() => pick('all')}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] ${
                selectedAccountId === 'all'
                  ? 'bg-[#EEF0FF] font-semibold text-[#4A46E5]'
                  : 'text-slate-800 hover:bg-slate-50'
              }`}
            >
              <span aria-hidden className="text-slate-400">
                ◌
              </span>
              Todas las líneas
              <CountPill value={totalOpen} active={selectedAccountId === 'all'} />
            </button>
          ) : null}

          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.key}>
                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.label} · {group.items.length} {group.items.length === 1 ? 'línea' : 'líneas'}
                </p>
                {group.items.map((acc) => {
                  const health = lineHealth(acc)
                  const active = selectedAccountId === acc.id
                  const down = health.needsAction
                  const address = accountChannelAddress(acc)
                  const count = countsByAccount.get(acc.id)?.open ?? 0
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-line-id={acc.id}
                      onClick={() => pick(acc.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left ${
                        active ? 'bg-[#EEF0FF]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <ChannelLogo platform={acc.platform} size={22} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] font-semibold ${
                            active ? 'text-[#4A46E5]' : 'text-slate-900'
                          }`}
                        >
                          {accountDisplayLabel(acc)}
                        </span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {[address, down ? health.label.toLowerCase() : null].filter(Boolean).join(' · ') ||
                            '—'}
                        </span>
                      </span>
                      {down ? (
                        <span aria-label={health.label} className="text-[13px] text-red-500">
                          ⓘ
                        </span>
                      ) : null}
                      <CountPill value={count} active={active} />
                    </button>
                  )
                })}
              </div>
            ),
          )}

          {visible.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12px] text-slate-400">Ninguna línea coincide.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
