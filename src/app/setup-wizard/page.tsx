import { requirePermission } from "@/lib/auth-helpers";
import { SetupWizard } from "./components/SetupWizard";

export default async function SetupWizardPage() {
  // Only OWNER and ADMIN can access setup wizard
  await requirePermission('update_config');

  return <SetupWizard />;
}

