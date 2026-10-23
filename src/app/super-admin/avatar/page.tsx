import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AuroraClassicPage } from '@/components/aurora/AuroraClassicPage'
import { BetsyBrandShowcase } from '@/components/brand/BetsyBrandShowcase'
import { authOptions } from '@/lib/auth-options'
import { isSuperAdmin } from '@/lib/super-admin-helpers'

/** Betsy mark + logo showcase: every state, size and agent plate on dark and light. Betsy platform admins only. */
export default async function BetsyBrandShowcasePage() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId) redirect('/auth/signin')
  if (!(await isSuperAdmin(userId))) redirect('/dashboard')
  return (
    <AuroraClassicPage
      title="Betsy · marca"
      subtitle="Marca oficial: estados, tamaños, logo y placas de agentes, sobre oscuro y crema"
      maxWidthClass="max-w-none"
      testId="betsy-avatar-showcase"
    >
      <BetsyBrandShowcase />
    </AuroraClassicPage>
  )
}
