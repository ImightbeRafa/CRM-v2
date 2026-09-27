import type { HTMLAttributes } from 'react'

/** White Aurora card used by every Config panel. */
export function ConfigCard({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={`rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 ${className}`} />
}
