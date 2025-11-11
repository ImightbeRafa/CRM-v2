import { getSessionWithTenant } from "@/lib/auth-helpers"
import EnhancedHomeContent from "./enhanced-home-content";

export default async function DashboardPage() {
  // Require authentication (all authenticated users can access dashboard)
  await getSessionWithTenant()
  
  return <EnhancedHomeContent />;
}