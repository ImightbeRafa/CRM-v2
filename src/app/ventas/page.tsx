import { requirePermission } from "@/lib/auth-helpers"
import VentasContent from "./components/VentasComponent"

export default async function VentasPage() {
  // Require 'view_sales' permission
  await requirePermission('view_sales')

  return <VentasContent />
}