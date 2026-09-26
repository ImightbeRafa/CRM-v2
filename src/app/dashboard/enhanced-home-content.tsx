'use client';
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import BetsyLogo from "@/BetsyLogo.png";
import { AuroraShell } from "@/components/aurora/AuroraShell";
import { AuroraMobileNav } from "@/components/aurora/AuroraMobileNav";
import { AuroraHome } from "./components/AuroraHome";

function displayName(session: NonNullable<ReturnType<typeof useSession>["data"]>) {
  const name = session.user?.name?.trim();
  if (name) return name.split(" ")[0];
  const email = session.user?.email ?? "";
  return email.split("@")[0] || "Usuario";
}

export default function EnhancedHomeContent() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <Image
              src={BetsyLogo}
              alt="Betsy CRM"
              width={140}
              height={140}
              className="object-contain"
              priority
            />
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
  const isLogisticsAdmin = Boolean((session.user as { isLogisticsAdmin?: boolean })?.isLogisticsAdmin);

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
