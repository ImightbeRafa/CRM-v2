import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { AuroraShell } from '@/components/aurora/AuroraShell';
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav';
import { AuroraTopActions } from '@/components/aurora/shell/AuroraTopActions';

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuroraShell fullBleed bottomNav={<AuroraMobileNav />}>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/70 bg-white px-4 py-3 sm:px-6">
        <Link href="/help" className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B6CFF] to-[#7C5CFF] text-white">
            <BookOpen className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[20px] font-semibold leading-tight text-slate-900">Centro de ayuda</span>
          </span>
        </Link>
        <AuroraTopActions />
      </header>

      <div className="aurora-light flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--aurora-canvas)] text-slate-900 [color-scheme:light]">
        {children}
      </div>
    </AuroraShell>
  );
}
