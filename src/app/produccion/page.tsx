import { ProductionPageClient } from './components/productionpageClient';
import { requirePermission } from "@/lib/auth-helpers"

export default async function ProductionPage() {
  // Require 'view_production' permission (SALES users will be redirected!)
  await requirePermission('view_production')

  return <ProductionPageClient />
}