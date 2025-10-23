import { requirePermission } from "@/lib/auth-helpers"

export default async function ConfigLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Require 'view_config' permission to access any /config page
  // This will redirect to /unauthorized if user doesn't have permission
  await requirePermission('view_config')

  return <>{children}</>
}

