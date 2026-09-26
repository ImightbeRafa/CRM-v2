'use client'

import { useState } from 'react'
import { Bot, MoreHorizontal, RefreshCw, User } from 'lucide-react'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import { socialReconnectBannerLabel } from '@/lib/social-account-token-health'
import {
  classifyChannelHealth,
  formatRelativeEs,
  type ChannelHealthTone,
} from '../channel-health'
import type { SocialAccount } from '../types'

const TONE_CLASS: Record<ChannelHealthTone, string> = {
  ok: 'bg-emerald-50 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
}

export interface ChannelsTableProps {
  accounts: SocialAccount[]
  loading: boolean
  /** Total owner channels before tab/search filtering (empty-state vs no-match). */
  totalCount: number
  agentNameByAccountId: Record<string, string>
  agentsKnown: boolean
  resolvedName: (acc: SocialAccount) => string
  secondaryLine: (acc: SocialAccount) => string
  isDuplicateName: (acc: SocialAccount) => boolean
  renamingId: string | null
  renameDraft: string
  renamingBusy: boolean
  resubscribing: string | null
  unlinking: string | null
  onRenameDraftChange: (value: string) => void
  onStartRename: (acc: SocialAccount) => void
  onCancelRename: () => void
  onSaveRename: (acc: SocialAccount) => void
  onDiagnose: () => void
  onRepair: (acc: SocialAccount) => void
  onReconnect: (acc: SocialAccount) => void
  onUnlink: (acc: SocialAccount) => void
  onAddLine: () => void
  children?: React.ReactNode
}

const btnBase = 'rounded-[10px] px-3 py-1.5 text-[12px] font-medium disabled:opacity-50'

export function ChannelsTable(props: ChannelsTableProps) {
  const { accounts, loading, totalCount } = props
  const [menuId, setMenuId] = useState<string | null>(null)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left" data-testid="channels-table">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="px-5 py-3">Canal</th>
            <th className="px-3 py-3">Agente</th>
            <th className="px-3 py-3">Salud</th>
            <th className="px-3 py-3">Último evento</th>
            <th className="px-5 py-3 text-right">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">
                Cargando canales…
              </td>
            </tr>
          ) : accounts.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-10 text-center">
                <p className="text-sm text-slate-500">
                  {totalCount === 0
                    ? 'Todavía no hay canales conectados. Agregá tu primera línea de WhatsApp para empezar a recibir mensajes en Chats.'
                    : 'Ningún canal coincide con el filtro.'}
                </p>
                {totalCount === 0 ? (
                  <button
                    type="button"
                    onClick={props.onAddLine}
                    className="mt-3 rounded-[10px] bg-[#5B6CFF] px-4 py-2 text-[13px] font-medium text-white"
                  >
                    + Agregar línea
                  </button>
                ) : null}
              </td>
            </tr>
          ) : (
            accounts.map((acc) => {
              const health = classifyChannelHealth(acc)
              const name = props.resolvedName(acc)
              const secondary =
                props.secondaryLine(acc) ||
                (acc.platform === 'instagram'
                  ? 'Sin handle todavía'
                  : acc.whatsappBusinessAccountId
                    ? `WABA …${acc.whatsappBusinessAccountId.slice(-4)}`
                    : 'Sin teléfono todavía')
              const agentName = props.agentNameByAccountId[acc.id]
              const lastEvent = formatRelativeEs(acc.lastWebhookAt)
              const renaming = props.renamingId === acc.id
              const rowBad = health.tone === 'bad'
              return (
                <tr
                  key={acc.id}
                  data-testid="channel-row"
                  className={`border-b border-slate-100 last:border-b-0 ${rowBad ? 'bg-red-50/40' : ''}`}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          acc.platform === 'instagram'
                            ? 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]'
                            : 'bg-emerald-50'
                        }`}
                      >
                        <ChannelLogo
                          platform={acc.platform}
                          size={18}
                          className={acc.platform === 'instagram' ? 'brightness-0 invert' : ''}
                        />
                      </span>
                      <div className="min-w-0">
                        {renaming ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={props.renameDraft}
                              onChange={(e) => props.onRenameDraftChange(e.target.value)}
                              maxLength={40}
                              className="w-40 rounded-md bg-slate-50 px-2 py-1 text-[13px] text-slate-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#5B6CFF]/30"
                              aria-label="Nuevo nombre del canal"
                            />
                            <button
                              type="button"
                              onClick={() => props.onSaveRename(acc)}
                              disabled={props.renamingBusy}
                              className="text-xs font-medium text-[#5B6CFF] disabled:opacity-50"
                            >
                              {props.renamingBusy ? 'Guardando…' : 'Guardar'}
                            </button>
                            <button
                              type="button"
                              onClick={props.onCancelRename}
                              disabled={props.renamingBusy}
                              className="text-xs font-medium text-slate-500 disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <p className="truncate text-[14px] font-semibold text-slate-900">{name}</p>
                        )}
                        <p className="truncate text-[12px] text-slate-500">{secondary}</p>
                        {props.isDuplicateName(acc) ? (
                          <p className="text-[10px] text-amber-700">
                            Nombre duplicado — podés distinguirlas renombrando.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    {agentName ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-[#F1EEFF] px-2 py-1 text-[12px] font-medium text-[#6D4AE8]">
                        <Bot className="h-3 w-3" aria-hidden />
                        {agentName}
                      </span>
                    ) : props.agentsKnown ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-600">
                        <User className="h-3 w-3" aria-hidden />
                        Solo humanos
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <span
                      className={`inline-flex rounded-md px-2 py-1 text-[12px] font-medium ${TONE_CLASS[health.tone]}`}
                    >
                      {health.label}
                    </span>
                  </td>
                  <td className={`px-3 py-3.5 text-[13px] ${rowBad ? 'text-red-600' : 'text-slate-500'}`}>
                    {lastEvent ?? '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="relative flex items-center justify-end gap-2">
                      {health.action === 'repair' ? (
                        <button
                          type="button"
                          onClick={() => props.onRepair(acc)}
                          disabled={props.resubscribing === acc.id}
                          className={`${btnBase} inline-flex items-center gap-1.5 bg-red-600 text-white hover:bg-red-700`}
                        >
                          <RefreshCw className="h-3 w-3" aria-hidden />
                          {props.resubscribing === acc.id ? 'Reparando…' : 'Reparar'}
                        </button>
                      ) : health.action === 'reconnect' ? (
                        <button
                          type="button"
                          onClick={() => props.onReconnect(acc)}
                          aria-label={socialReconnectBannerLabel({
                            id: acc.id,
                            platform: acc.platform,
                            accountId: acc.accountId,
                            tokenStatus: acc.tokenStatus,
                            displayName: acc.displayName,
                            providerDisplayName: acc.providerDisplayName,
                            providerUsername: acc.providerUsername,
                            displayPhoneNumber: acc.displayPhoneNumber,
                          })}
                          className={`${btnBase} inline-flex items-center gap-1.5 bg-[#5B6CFF] text-white hover:bg-[#4A5AE8]`}
                        >
                          <RefreshCw className="h-3 w-3" aria-hidden />
                          Reconectar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={props.onDiagnose}
                          className={`${btnBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
                        >
                          Diagnóstico
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setMenuId(menuId === acc.id ? null : acc.id)}
                        aria-label={`Más acciones de ${name}`}
                        aria-expanded={menuId === acc.id}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                      {menuId === acc.id ? (
                        <>
                          <button
                            type="button"
                            aria-label="Cerrar menú"
                            className="fixed inset-0 z-10 cursor-default"
                            onClick={() => setMenuId(null)}
                          />
                          <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                            <MenuItem
                              onClick={() => {
                                setMenuId(null)
                                props.onStartRename(acc)
                              }}
                            >
                              Renombrar
                            </MenuItem>
                            {health.action !== 'repair' && !acc.disconnectedAt ? (
                              <MenuItem
                                onClick={() => {
                                  setMenuId(null)
                                  props.onDiagnose()
                                }}
                              >
                                Diagnóstico
                              </MenuItem>
                            ) : null}
                            <MenuItem
                              danger
                              disabled={props.unlinking === acc.id}
                              onClick={() => {
                                setMenuId(null)
                                props.onUnlink(acc)
                              }}
                            >
                              {props.unlinking === acc.id ? 'Desvinculando…' : 'Desvincular'}
                            </MenuItem>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
      {props.children}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50 disabled:opacity-50 ${
        danger ? 'text-red-600' : 'text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}
