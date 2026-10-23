import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { BetsyAvatarShowcase } from '@/components/brand/betsy-avatar/BetsyAvatarShowcase'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'

/** Betsy avatar + logo showcase: every mood and variant on dark and light. Betsy platform admins only. */
export default async function BetsyAvatarShowcasePage() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  return (
    <AuroraClassicPage
      title="Betsy · avatar"
      subtitle="Estados, variantes por agente y logo, sobre fondo oscuro y claro"
      maxWidthClass="max-w-none"
      testId="betsy-avatar-showcase"
    >
      <BetsyAvatarShowcase />
    </AuroraClassicPage>
  )
}
