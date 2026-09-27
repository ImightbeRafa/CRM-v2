import { BookOpen } from 'lucide-react';
import { AuroraShell } from '@/components/aurora/AuroraShell';
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav';
import { AuroraPageHeader } from '@/components/aurora/shell/AuroraPageHeader';

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuroraShell fullBleed bottomNav={<AuroraMobileNav />}>
      <AuroraPageHeader
        title="Centro de ayuda"
        leading={
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B6CFF] to-[#7C5CFF] text-white">
            <BookOpen className="h-4 w-4" aria-hidden />
          </span>
        }
        className="items-center"
      />

      <div className="aurora-light flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--aurora-canvas)] text-slate-900 [color-scheme:light]">
        {children}
      </div>
    </AuroraShell>
  );
}
