'use client'

import type { ReactNode } from 'react'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'
import { AuroraPageHeader } from '@/components/aurora/shell/AuroraPageHeader'

type AuroraClassicPageProps = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  /** Max content width (Tailwind class). Default keeps dashboards readable on wide screens. */
  maxWidthClass?: string
  testId?: string
}

/**
 * Aurora chrome (sidebar, header, mobile nav) around a classic page body. Presentation only:
 * `aurora-light` keeps shadcn tokens light and disables `dark:` utilities inside, so existing
 * dashboards (exports, backups, ventas dashboard, super-admin) match Aurora without logic changes.
 */
export function AuroraClassicPage({
  title,
  subtitle,
  actions,
  children,
  maxWidthClass = 'max-w-7xl',
  testId,
}: AuroraClassicPageProps) {
  return (
    <AuroraShell fullBleed bottomNav={<AuroraMobileNav />}>
      <AuroraPageHeader title={title} subtitle={subtitle} actions={actions} />
      <div
        className="aurora-light min-h-0 flex-1 overflow-y-auto bg-[var(--aurora-canvas)] text-slate-900"
        data-testid={testId}
      >
        <main className={`mx-auto w-full ${maxWidthClass} space-y-4 px-3 py-4 sm:px-6`}>{children}</main>
      </div>
    </AuroraShell>
  )
}
