import { requirePermission } from '@/lib/auth-helpers'

export default async function SocialConfigLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requirePermission('update_config')
  return <>{children}</>
}
