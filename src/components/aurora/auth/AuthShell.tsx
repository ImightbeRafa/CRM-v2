import type { ReactNode } from 'react'
import { BetsyWordmark } from './BetsyWordmark'

type AuthShellProps = {
  title: string
  subtitle?: string
  children: ReactNode
  /** Small text under the card (links, legal). */
  footer?: ReactNode
  /** Dark brand panel on the left at `lg+`. Default true. */
  brandPanel?: boolean
  /** Icon / badge rendered above the title (e.g. success check). */
  icon?: ReactNode
  /** Wider card (onboarding wizard). */
  wide?: boolean
}

/**
 * Aurora auth chrome: cream canvas, centered white card, gradient wordmark and an optional
 * dark brand panel on desktop. `aurora-light` keeps shadcn tokens light under `html.dark`.
 */
export function AuthShell({ title, subtitle, children, footer, brandPanel = true, icon, wide = false }: AuthShellProps) {
  return (
    <div className="aurora-light flex min-h-dvh bg-[var(--aurora-canvas)] text-slate-900 [color-scheme:light]">
      {brandPanel ? (
        <aside className="relative hidden w-[42%] max-w-[560px] shrink-0 flex-col justify-between overflow-hidden bg-[#0E0D17] p-10 text-white lg:flex">
          <BetsyWordmark tone="dark" />
          <div>
            <p className="text-[28px] font-semibold leading-tight tracking-tight">
              Ventas, chats y envíos en un solo lugar.
            </p>
            <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-white/60">
              Atendé a tus clientes, controlá tus pedidos y mandá con Correos de Costa Rica desde Betsy.
            </p>
          </div>
          <p className="text-[12px] text-white/40">© {new Date().getFullYear()} Betsy CRM</p>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#5B6CFF]/20 blur-3xl"
          />
        </aside>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className={`mb-6 ${brandPanel ? 'lg:hidden' : ''}`}>
          <BetsyWordmark />
        </div>
        <div
          className={`w-full ${wide ? 'max-w-[720px]' : 'max-w-[420px]'} rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm sm:p-8`}
        >
          <div className="mb-6 text-center">
            {icon ? <div className="mb-4 flex justify-center">{icon}</div> : null}
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900">{title}</h1>
            {subtitle ? <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">{subtitle}</p> : null}
          </div>
          {children}
        </div>
        {footer ? <div className="mt-5 text-center text-[13px] text-slate-500">{footer}</div> : null}
      </main>
    </div>
  )
}

/** Shared field / button classes for Aurora auth forms. */
export const authInputClass =
  'block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#7C5CFF] focus:ring-2 focus:ring-[#7C5CFF]/20 disabled:opacity-60'
export const authLabelClass = 'mb-1 block text-[13px] font-medium text-slate-700'
export const authPrimaryButtonClass =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
export const authSecondaryButtonClass =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[14px] font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
export const authLinkClass = 'font-medium text-[#5B3FE0] hover:underline'
export const authErrorClass = 'rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700'
export const authSuccessClass = 'rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800'
