import { getSessionWithTenant } from "@/lib/auth-helpers"
import HomeContent from "./home-content";

export default async function HomePage() {
  // Require authentication (all authenticated users can access home)
  await getSessionWithTenant()
  
  return <HomeContent />;
}