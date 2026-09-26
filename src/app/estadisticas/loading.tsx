import { AuroraShell } from '@/components/aurora/AuroraShell'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'

export default function EstadisticasLoading() {
  return (
    <AuroraShell bottomNav={<AuroraMobileNav />}>
      <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
        <div className="flex h-[68px] shrink-0 items-center border-b border-slate-200/70 bg-white px-4 md:px-8">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pt-5 md:px-7">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[120px] animate-pulse rounded-2xl border border-slate-200/70 bg-white" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200/70 bg-white" />
        </div>
      </div>
    </AuroraShell>
  )
}
