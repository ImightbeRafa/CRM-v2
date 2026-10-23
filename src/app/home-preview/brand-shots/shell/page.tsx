'use client'
// TEMPORARY local screenshot harness — NOT committed.
import { AuroraSidebar } from '@/components/aurora/AuroraSidebar'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'
export default function S() {
  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--aurora-canvas)] md:flex-row">
      <AuroraSidebar />
      <main className="flex-1 p-8 text-slate-500">Contenido</main>
      <AuroraMobileNav chatsBadge={3} />
    </div>
  )
}
