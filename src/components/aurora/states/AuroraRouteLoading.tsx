'use client'

import { AuroraShell, useInAuroraFrame } from '../AuroraShell'
import { AuroraMobileNav } from '../AuroraMobileNav'
import { AuroraListSkeleton, AuroraThreadSkeleton } from './AuroraSkeleton'

export type AuroraRouteLoadingVariant = 'page' | 'list' | 'chats'

function Pulse({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />
}

function HeaderSkeleton() {
  return (
    <div className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white px-4 md:px-6">
      <div className="space-y-2">
        <Pulse className="h-4 w-36" />
        <Pulse className="h-2.5 w-56" />
      </div>
      <Pulse className="hidden h-9 w-28 rounded-xl md:block" />
    </div>
  )
}

function PageBody() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pt-5 md:px-7">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[120px] animate-pulse rounded-2xl border border-slate-200/70 bg-white" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-slate-200/70 bg-white" />
    </div>
  )
}

function ListBody() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-3 py-4 sm:px-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Pulse key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200/70 bg-white">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0">
            <Pulse className="h-4 w-20" />
            <Pulse className={`h-4 ${i % 2 ? 'w-40' : 'w-28'}`} />
            <Pulse className="hidden h-4 w-24 md:block" />
            <Pulse className="ml-auto h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatsBody() {
  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-white">
      <div className="hidden w-[208px] shrink-0 space-y-3 border-r border-slate-200/70 p-4 lg:block">
        <Pulse className="h-8 w-full rounded-xl" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Pulse key={i} className="h-7 w-3/4" />
        ))}
      </div>
      <div className="w-full shrink-0 border-r border-slate-200/70 md:w-[300px]">
        <AuroraListSkeleton rows={8} />
      </div>
      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        <div className="h-[72px] shrink-0 border-b border-slate-200/70 px-5 py-4">
          <Pulse className="h-4 w-40" />
        </div>
        <AuroraThreadSkeleton />
      </div>
    </div>
  )
}

/**
 * Route-level loading state (`loading.tsx`). Inside the persistent Aurora frame it renders only
 * the content skeleton, so the sidebar never blinks and no pre-Aurora skeleton shows up.
 */
export function AuroraRouteLoading({ variant = 'page' }: { variant?: AuroraRouteLoadingVariant }) {
  const body = variant === 'chats' ? <ChatsBody /> : variant === 'list' ? <ListBody /> : <PageBody />
  return (
    <AuroraShell fullBleed={variant !== 'page'} bottomNav={<AuroraMobileNav />}>
      <div className="flex min-h-0 flex-1 flex-col" role="status" aria-busy="true" aria-label="Cargando">
        {variant !== 'chats' ? <HeaderSkeleton /> : null}
        {body}
      </div>
    </AuroraShell>
  )
}

/** Root fallback: Aurora skeleton inside the frame, a quiet brand spinner everywhere else. */
export function AppRouteLoading() {
  const inFrame = useInAuroraFrame()
  if (inFrame) return <AuroraRouteLoading />
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center" role="status" aria-busy="true" aria-label="Cargando">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#5B6CFF]/20 border-t-[#5B6CFF]" />
    </div>
  )
}
