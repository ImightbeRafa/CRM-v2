import { getSessionWithTenant } from "@/lib/auth-helpers"
import HomeContent from "./home-content";

export default async function DashboardPage() {
  // Require authentication (all authenticated users can access dashboard)
  await getSessionWithTenant()
  
  return <HomeContent />;
}