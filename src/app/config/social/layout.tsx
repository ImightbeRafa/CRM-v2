import { requirePermission } from '@/lib/auth-helpers'
import { ConfigShell } from '@/components/aurora/config/ConfigShell'

export default async function SocialConfigLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requirePermission('update_config')
  // Real page (Embedded Signup fallback) with the same Config chrome as `/config?tab=social`.
  return <ConfigShell activeTab="social">{children}</ConfigShell>
}
