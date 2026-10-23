'use client';
import { useSession } from "next-auth/react";
import Link from "next/link";
import { BetsyLogo } from "@/components/brand/BetsyLogo";
import { AuroraShell } from "@/components/aurora/AuroraShell";
import { AuroraMobileNav } from "@/components/aurora/AuroraMobileNav";
import { AuroraHome } from "./components/AuroraHome";
import { canAccessLogistics } from "@/lib/logistics-access";

function displayName(session: NonNullable<ReturnType<typeof useSession>["data"]>) {
  const name = session.user?.name?.trim();
  // Some accounts store the email as `name`: greet with the part before "@".
  if (name) return name.includes("@") ? name.split("@")[0] : name.split(" ")[0];
  const email = session.user?.email ?? "";
  return email.split("@")[0] || "Usuario";
}

export default function EnhancedHomeContent() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="min-h-full flex items-center justify-center bg-background py-16">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-full flex items-center justify-center bg-background py-16">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <BetsyLogo tone="auto" size={44} />
          </div>

          <p className="text-muted-foreground mb-8">Por favor, inicia sesión para continuar</p>
          <Link
            href="/auth/signin"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = session.user?.role === 'MASTER'
    || session.user?.membershipRole === 'OWNER'
    || session.user?.currentTenant?.role === 'OWNER';
  const isLogisticsAdmin = canAccessLogistics({
    isLogisticsAdmin: Boolean((session.user as { isLogisticsAdmin?: boolean })?.isLogisticsAdmin),
    membershipTenantIds:
      (session.user as { allTenantIds?: string[] }).allTenantIds ||
      ((session.user as { memberships?: Array<{ tenantId?: string }> }).memberships || []).map((m) => m.tenantId),
  });

  return (
    <AuroraShell bottomNav={<AuroraMobileNav />}>
      <AuroraHome
        firstName={displayName(session)}
        tenantName={session.user?.currentTenant?.name}
        isOwner={isOwner}
        isLogisticsAdmin={isLogisticsAdmin}
      />
    </AuroraShell>
  );
}
