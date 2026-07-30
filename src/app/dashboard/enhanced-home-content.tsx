'use client';
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import LogoutButton from "@/app/components/LogoutButton";
import { WhatsNewDrawer } from "@/app/components/WhatsNewDrawer";
import { MobileBottomNav } from "@/app/components/MobileBottomNav";
import { useDashboardStats } from "@/app/hooks/useDashboardStats";
import BetsyLogo from "@/BetsyLogo.png";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import {
  Zap, Settings, TrendingUp, Users, Package, Truck,
  ShoppingCart, Plus, BarChart3, DollarSign, ArrowUpRight, Clock, RefreshCw, BookOpen
} from "lucide-react";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { SetupChecklist } from "./components/SetupChecklist";

const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const },
};

const cardHover = {
  whileHover: { y: -3, transition: { duration: 0.2 } },
  whileTap: { scale: 0.98 },
};

function displayName(session: NonNullable<ReturnType<typeof useSession>["data"]>) {
  const name = session.user?.name?.trim();
  if (name) return name.split(" ")[0];
  const email = session.user?.email ?? "";
  return email.split("@")[0] || "Usuario";
}

export default function EnhancedHomeContent() {
  const { data: session, status } = useSession();
  const { stats, isLoading: isLoadingStats, refresh: refreshStats } = useDashboardStats();

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
            Iniciar Sesión
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = session.user?.role === 'MASTER'
    || session.user?.membershipRole === 'OWNER'
    || session.user?.currentTenant?.role === 'OWNER';
  const isMaster = session.user?.role === 'MASTER';
  const isLogisticsAdmin = Boolean((session.user as { isLogisticsAdmin?: boolean })?.isLogisticsAdmin);
  const greeting = displayName(session);

  return (
    <div className="min-h-screen bg-background">
      <motion.main
        {...pageTransition}
        className="container mx-auto px-4 md:px-6 py-4 md:py-8 app-shell-content md:pb-8"
      >
        {/* —— Mobile header —— */}
        <header className="md:hidden mb-5">
          <div className="flex items-center gap-3">
            <Image
              src={BetsyLogo}
              alt="Betsy CRM"
              width={44}
              height={44}
              className="object-contain flex-shrink-0 h-11 w-11"
              priority
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold text-foreground truncate">
                  Hola, {greeting}
                </p>
                {isMaster && (
                  <span className="bg-red-600 text-white text-[10px] leading-none px-1.5 py-1 rounded font-bold flex-shrink-0">
                    M
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Sistema de Gestión</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <WhatsNewDrawer />
              <LogoutButton compact />
            </div>
          </div>
        </header>

        {/* —— Desktop header —— */}
        <div className="hidden md:flex md:justify-between md:items-center gap-4 mb-8">
          <div className="flex-1 flex items-center gap-3">
            <Image
              src={BetsyLogo}
              alt="Betsy CRM"
              width={80}
              height={80}
              className="object-contain flex-shrink-0"
              style={{ width: 'auto', height: '5rem' }}
              priority
            />
            <div>
              <p className="text-base text-muted-foreground">Sistema de Gestión</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  Bienvenido, {session.user?.email}
                </p>
                {isMaster && (
                  <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full font-bold flex-shrink-0">
                    M
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => refreshStats(true)}
              disabled={isLoadingStats}
              className="inline-flex items-center justify-center bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors text-base min-h-[44px] disabled:opacity-50"
              title="Actualizar estadísticas"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingStats ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>
            {isMaster && (
              <Link
                href="/config"
                className="inline-flex items-center justify-center bg-gray-800 text-white px-4 py-2 rounded-md hover:bg-gray-900 transition-colors text-base min-h-[44px]"
              >
                <Settings className="w-4 h-4 mr-2" />
                <span>Configuración</span>
              </Link>
            )}
            <ThemeToggle />
            <WhatsNewDrawer />
            <LogoutButton />
          </div>
        </div>

        {/* Primary action */}
        <div className="flex flex-wrap gap-3 mb-5 md:mb-6">
          <Link
            href="/ventas"
            className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-3 md:py-2.5 rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-md hover:shadow-lg text-sm min-h-[44px] w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Crear Pedido
          </Link>
          <Link
            href="/help"
            className="hidden md:inline-flex items-center gap-2 bg-card text-foreground px-4 py-2.5 rounded-xl hover:bg-accent transition-colors border text-sm"
          >
            <BookOpen className="h-4 w-4" />
            Centro de Ayuda
          </Link>
        </div>

        {isOwner && (
          <SetupChecklist />
        )}

        {/* Stats heading + refresh (mobile) */}
        <div className="flex items-center justify-between mb-3 md:hidden">
          <h2 className="text-sm font-semibold text-foreground">Resumen</h2>
          <button
            onClick={() => refreshStats(true)}
            disabled={isLoadingStats}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 min-h-[44px] px-2 disabled:opacity-50"
            aria-label="Actualizar estadísticas"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingStats ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        {/* Stats — 2×2 on mobile, 4-col grid on desktop (no carousel) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-6">
          <Card className="border-t-4 border-t-blue-500 md:border-t-0 md:border-l-4 md:border-l-blue-600">
            <CardHeader className="pb-1 pt-3 px-3 md:pb-2 md:pt-6 md:px-6">
              <CardDescription className="flex items-center gap-1.5 text-muted-foreground text-xs md:text-sm">
                <ShoppingCart className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                <span className="truncate">Pedidos Semana</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <div className="flex items-baseline justify-between gap-1">
                <p className="text-2xl md:text-3xl font-bold text-foreground tabular-nums">
                  {isLoadingStats ? '…' : stats.ordersWeek}
                </p>
                {!isLoadingStats && stats.ordersChange !== 0 && (
                  <span className={`text-xs md:text-sm flex items-center flex-shrink-0 ${
                    stats.ordersChange > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <TrendingUp className={`h-3 w-3 mr-0.5 ${
                      stats.ordersChange < 0 ? 'rotate-180' : ''
                    }`} />
                    {stats.ordersChange > 0 ? '+' : ''}{stats.ordersChange}%
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4 border-t-orange-400 md:border-t-0 md:border-l-4 md:border-l-orange-500">
            <CardHeader className="pb-1 pt-3 px-3 md:pb-2 md:pt-6 md:px-6">
              <CardDescription className="flex items-center gap-1.5 text-muted-foreground text-xs md:text-sm">
                <Clock className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                <span className="truncate">Pendientes</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <div className="flex items-baseline justify-between gap-1">
                <p className="text-2xl md:text-3xl font-bold text-foreground tabular-nums">
                  {isLoadingStats ? '…' : stats.pendingOrders}
                </p>
                {stats.pendingOrders > 0 && (
                  <Link href="/ventas?status=pending" className="text-orange-600 text-xs md:text-sm hover:underline flex-shrink-0">
                    Ver →
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4 border-t-purple-500 md:border-t-0 md:border-l-4 md:border-l-purple-600">
            <CardHeader className="pb-1 pt-3 px-3 md:pb-2 md:pt-6 md:px-6">
              <CardDescription className="flex items-center gap-1.5 text-muted-foreground text-xs md:text-sm">
                <Users className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                <span className="truncate">Clientes</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <div className="flex items-baseline justify-between gap-1">
                <p className="text-2xl md:text-3xl font-bold text-foreground tabular-nums">
                  {isLoadingStats ? '…' : stats.totalClients}
                </p>
                {!isLoadingStats && stats.newClientsThisWeek > 0 && (
                  <span className="text-purple-600 text-xs md:text-sm flex items-center flex-shrink-0">
                    <ArrowUpRight className="h-3 w-3 mr-0.5" />
                    +{stats.newClientsThisWeek}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4 border-t-emerald-500 md:border-t-0 md:border-l-4 md:border-l-green-600">
            <CardHeader className="pb-1 pt-3 px-3 md:pb-2 md:pt-6 md:px-6">
              <CardDescription className="flex items-center gap-1.5 text-muted-foreground text-xs md:text-sm">
                <DollarSign className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                <span className="truncate">Ventas Semana</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <div className="flex items-baseline justify-between gap-1">
                <p className="text-xl md:text-2xl font-bold text-foreground tabular-nums truncate">
                  {isLoadingStats ? '…' : stats.weeklyRevenue >= 1000
                    ? `₡${(stats.weeklyRevenue / 1000).toFixed(1)}k`
                    : `₡${stats.weeklyRevenue}`
                  }
                </p>
                {!isLoadingStats && stats.revenueChange !== 0 && (
                  <span className={`text-xs md:text-sm flex items-center flex-shrink-0 ${
                    stats.revenueChange > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <TrendingUp className={`h-3 w-3 mr-0.5 ${
                      stats.revenueChange < 0 ? 'rotate-180' : ''
                    }`} />
                    {stats.revenueChange > 0 ? '+' : ''}{stats.revenueChange}%
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <div className="mb-3 md:mb-4">
              <h2 className="text-base md:text-2xl font-bold text-foreground mb-0 md:mb-2">Accesos Rápidos</h2>
              <p className="text-muted-foreground hidden md:block">Navega a las secciones principales del sistema</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:gap-6">
              <motion.div {...cardHover}>
              <Link
                href="/ventas"
                className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-blue-300 dark:hover:border-blue-700 overflow-hidden block min-h-[96px]"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-400/10 to-blue-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500 hidden md:block"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-2 md:mb-4">
                    <div className="p-2.5 md:p-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                      <ShoppingCart className="w-5 h-5 md:w-7 md:h-7 text-white" />
                    </div>
                    <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6 text-blue-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                  </div>
                  <h3 className="text-base md:text-xl font-bold text-card-foreground mb-0 md:mb-2">Ventas</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed hidden md:block">Gestionar pedidos y clientes</p>
                </div>
              </Link>
              </motion.div>

              <motion.div {...cardHover}>
              <Link
                href="/produccion"
                className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-purple-300 dark:hover:border-purple-700 overflow-hidden block min-h-[96px]"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-purple-400/10 to-purple-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500 hidden md:block"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-2 md:mb-4">
                    <div className="p-2.5 md:p-4 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                      <Package className="w-5 h-5 md:w-7 md:h-7 text-white" />
                    </div>
                    <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6 text-purple-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                  </div>
                  <h3 className="text-base md:text-xl font-bold text-card-foreground mb-0 md:mb-2">Producción</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed hidden md:block">Gestionar producción y órdenes</p>
                </div>
              </Link>
              </motion.div>

              <motion.div {...cardHover}>
              <Link
                href="/estadisticas"
                className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-green-300 dark:hover:border-green-700 overflow-hidden block min-h-[96px]"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-400/10 to-green-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500 hidden md:block"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-2 md:mb-4">
                    <div className="p-2.5 md:p-4 bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                      <BarChart3 className="w-5 h-5 md:w-7 md:h-7 text-white" />
                    </div>
                    <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6 text-green-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                  </div>
                  <h3 className="text-base md:text-xl font-bold text-card-foreground mb-0 md:mb-2">Estadísticas</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed hidden md:block">Análisis y reportes detallados</p>
                </div>
              </Link>
              </motion.div>

              {/* Config — desktop only; mobile uses Más drawer */}
              {isMaster && (
                <motion.div {...cardHover} className="hidden md:block">
                <Link
                  href="/config"
                  className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-gray-300 dark:hover:border-gray-600 overflow-hidden block min-h-[96px]"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-gray-400/10 to-gray-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
                  <div className="relative">
                    <div className="flex items-start justify-between mb-2 md:mb-4">
                      <div className="p-2.5 md:p-4 bg-gradient-to-br from-gray-700 to-gray-900 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                        <Settings className="w-5 h-5 md:w-7 md:h-7 text-white" />
                      </div>
                      <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6 text-gray-800 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                    </div>
                    <h3 className="text-base md:text-xl font-bold text-card-foreground mb-0 md:mb-2">Configuración</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed hidden md:block">Ajustes del sistema</p>
                  </div>
                </Link>
                </motion.div>
              )}

              {isLogisticsAdmin && (
                <motion.div {...cardHover}>
                <Link
                  href="/logistics"
                  className="group relative bg-gradient-to-br from-[#0D0D0D] to-[#1a1a2e] p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-indigo-900/40 hover:border-indigo-500/60 overflow-hidden block min-h-[96px]"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-500/20 to-blue-500/20 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500 hidden md:block"></div>
                  <div className="relative">
                    <div className="flex items-start justify-between mb-2 md:mb-4">
                      <div className="p-2.5 md:p-4 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow" style={{ boxShadow: '0 0 18px rgba(108,63,255,0.4)' }}>
                        <Truck className="w-5 h-5 md:w-7 md:h-7 text-white" />
                      </div>
                      <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6 text-indigo-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                    </div>
                    <h3 className="text-base md:text-xl font-bold text-white mb-0 md:mb-2">Logística</h3>
                    <p className="text-sm text-gray-400 leading-relaxed hidden md:block">Envíos, guías y carriers</p>
                  </div>
                </Link>
                </motion.div>
              )}
            </div>
          </div>

          {/* Sidebar — desktop only to reduce mobile clutter */}
          <div className="hidden md:block space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-600" />
                  Acciones Rápidas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/config?tab=inventory" className="w-full">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Agregar Inventario
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>

        <footer className="mt-8 md:mt-12 text-center text-muted-foreground text-sm">
          <p>© 2024 Betsy CRM</p>
          <p className="mt-1">v1.0.1</p>
        </footer>
      </motion.main>

      <MobileBottomNav />
    </div>
  );
}
