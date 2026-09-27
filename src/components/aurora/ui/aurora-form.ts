/** Shared Aurora form / button classes for modals, drawers and panels. */
export const auroraPrimaryGradient = 'bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF]'

export const auroraInputClass =
  'block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-[#7C5CFF] focus:ring-2 focus:ring-[#7C5CFF]/20 disabled:bg-slate-50 disabled:opacity-70'

export const auroraLabelClass = 'mb-1 block text-[12px] font-medium text-slate-700'

const BTN = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] focus-visible:ring-offset-2'

export const auroraBtnPrimary = `${BTN} ${auroraPrimaryGradient} text-white shadow-sm hover:opacity-90`
export const auroraBtnSecondary = `${BTN} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`
export const auroraBtnDanger = `${BTN} bg-red-600 text-white shadow-sm hover:bg-red-700`
