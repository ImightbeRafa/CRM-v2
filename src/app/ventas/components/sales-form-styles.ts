/**
 * Aurora presentation tokens for the Crear pedido form and its children.
 * Class strings only — no behavior. Inputs use 16px on phones so iOS Safari does
 * not zoom the page when a field gets focus.
 */

const INPUT_BASE =
  'block w-full rounded-xl border bg-white px-3 py-2.5 text-[16px] text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition sm:text-[14px] focus:ring-2 disabled:bg-slate-50 disabled:opacity-70'

/** Text / select / date inputs. `error` swaps to the red state (same condition as before). */
export function sfInput(error?: unknown): string {
  return `${INPUT_BASE} ${
    error
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
      : 'border-slate-200 focus:border-[#7C5CFF] focus:ring-[#7C5CFF]/20'
  }`
}

export const sfLabel = 'mb-1 block text-[12px] font-medium text-slate-600'
export const sfError = 'mt-1 text-[12px] font-medium text-red-600'
export const sfHelp = 'mt-1 text-[12px] text-slate-500'

/** White section card on the cream drawer canvas. */
export const sfSection =
  'rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-slate-200/70 sm:p-5'

/** Nested soft panel inside a section (e.g. "Info cliente", Mensajería). */
export const sfPanel = 'rounded-xl bg-slate-50/80 p-3 ring-1 ring-slate-200/60 sm:p-4'

export const sfBtnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

export const sfBtnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] disabled:cursor-not-allowed disabled:opacity-50'
