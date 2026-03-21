'use client';
import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { 
  Sparkles, Zap, Settings, TrendingUp, Users, Package, Truck,
  ShoppingCart, Plus, BarChart3, DollarSign, ArrowUpRight, Clock, RefreshCw, MessageSquare
} from "lucide-react";
import { ThemeToggle } from "@/app/components/ThemeToggle";

const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
};

const cardHover = {
  whileHover: { y: -3, transition: { duration: 0.2 } },
  whileTap: { scale: 0.98 },
};

export default function EnhancedHomeContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [showWizardModal, setShowWizardModal] = useState(false);
  const { stats, isLoading: isLoadingStats, refresh: refreshStats } = useDashboardStats();
  const statsScrollRef = useRef<HTMLDivElement>(null);
  const [activeStatCard, setActiveStatCard] = useState(0);

  const handleStatsScroll = useCallback(() => {
    const el = statsScrollRef.current;
    if (!el) return;
    const cardWidth = el.scrollWidth / 4;
    const idx = Math.round(el.scrollLeft / cardWidth);
    setActiveStatCard(Math.min(idx, 3));
  }, []);

  useEffect(() => {
    const el = statsScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleStatsScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleStatsScroll);
  }, [handleStatsScroll]);

  const fetchStats = (forceRefresh = false) => refreshStats(forceRefresh);

  // Show loading state while checking authentication
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

  // If not authenticated, show sign in prompt
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

  // Main content for authenticated users
  return (
    <div className="min-h-screen bg-background">
      <motion.main
        {...pageTransition}
        className="container mx-auto px-4 md:px-6 py-6 md:py-8 pb-24 md:pb-8"
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-8">
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
              <p className="text-sm md:text-base text-muted-foreground">Sistema de Gestión</p>
              <div className="flex items-center gap-2">
                <p className="text-xs md:text-sm text-muted-foreground truncate max-w-[200px] sm:max-w-none">
                  Bienvenido, {session.user?.email}
                </p>
                {session.user?.role === 'MASTER' && (
                  <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full font-bold flex-shrink-0">
                    M
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={() => fetchStats(true)}
              disabled={isLoadingStats}
              className="inline-flex items-center justify-center bg-blue-600 text-white px-3 md:px-4 py-2.5 md:py-2 rounded-md hover:bg-blue-700 transition-colors text-sm md:text-base min-h-[44px] disabled:opacity-50"
              title="Actualizar estadísticas"
            >
              <RefreshCw className={`w-4 h-4 md:mr-2 ${isLoadingStats ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">Actualizar</span>
            </button>
            {session.user?.role === 'MASTER' && (
              <Link
                href="/config"
                className="inline-flex items-center justify-center bg-gray-800 text-white px-3 md:px-4 py-2.5 md:py-2 rounded-md hover:bg-gray-900 transition-colors text-sm md:text-base min-h-[44px]"
              >
                <Settings className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Configuración</span>
              </Link>
            )}
            <ThemeToggle />
            <WhatsNewDrawer />
            <div className="hidden md:block">
              <LogoutButton />
            </div>
          </div>
        </div>

        {/* Quick Action Bar */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Link
            href="/ventas"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-md hover:shadow-lg text-sm"
          >
            <Plus className="h-4 w-4" />
            Crear Pedido
          </Link>
          <Link
            href="/help"
            className="inline-flex items-center gap-2 bg-card text-foreground px-4 py-2.5 rounded-xl hover:bg-accent transition-colors border text-sm"
          >
            📖 Centro de Ayuda
          </Link>
        </div>

        {/* Quick Stats Cards -- horizontal snap-scroll on mobile, grid on desktop */}
        <div ref={statsScrollRef} className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 snap-scroll-hide md:grid md:grid-cols-2 lg:grid-cols-4 md:gap-6 md:overflow-visible mb-2">
          <div className="min-w-[70vw] snap-center md:min-w-0">
            <Card className="h-full border-t-4 border-t-blue-500 md:border-t-0 md:border-l-4 md:border-l-blue-600">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2 text-muted-foreground">
                  <ShoppingCart className="h-4 w-4" />
                  Pedidos Esta Semana
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline justify-between">
                  <p className="text-4xl md:text-3xl font-bold text-foreground">{isLoadingStats ? '...' : stats.ordersWeek}</p>
                  {!isLoadingStats && stats.ordersChange !== 0 && (
                    <span className={`text-sm flex items-center ${
                      stats.ordersChange > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      <TrendingUp className={`h-3 w-3 mr-1 ${
                        stats.ordersChange < 0 ? 'rotate-180' : ''
                      }`} />
                      {stats.ordersChange > 0 ? '+' : ''}{stats.ordersChange}%
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="min-w-[70vw] snap-center md:min-w-0">
            <Card className="h-full border-t-4 border-t-orange-400 md:border-t-0 md:border-l-4 md:border-l-orange-500">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Pendientes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline justify-between">
                  <p className="text-4xl md:text-3xl font-bold text-foreground">{isLoadingStats ? '...' : stats.pendingOrders}</p>
                  {stats.pendingOrders > 0 && (
                    <Link href="/ventas?status=pending" className="text-orange-600 text-sm hover:underline">
                      Ver →
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="min-w-[70vw] snap-center md:min-w-0">
            <Card className="h-full border-t-4 border-t-purple-500 md:border-t-0 md:border-l-4 md:border-l-purple-600">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Total Clientes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline justify-between">
                  <p className="text-4xl md:text-3xl font-bold text-foreground">{isLoadingStats ? '...' : stats.totalClients}</p>
                  {!isLoadingStats && stats.newClientsThisWeek > 0 && (
                    <span className="text-purple-600 text-sm flex items-center">
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                      +{stats.newClientsThisWeek}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="min-w-[70vw] snap-center md:min-w-0">
            <Card className="h-full border-t-4 border-t-emerald-500 md:border-t-0 md:border-l-4 md:border-l-green-600">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2 text-muted-foreground">
                  <DollarSign className="h-4 w-4" />
                  Ventas Esta Semana
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline justify-between">
                  <p className="text-4xl md:text-2xl font-bold text-foreground">
                    {isLoadingStats ? '...' : stats.weeklyRevenue >= 1000 
                      ? `₡${(stats.weeklyRevenue / 1000).toFixed(1)}k` 
                      : `₡${stats.weeklyRevenue}`
                    }
                  </p>
                  {!isLoadingStats && stats.revenueChange !== 0 && (
                    <span className={`text-sm flex items-center ${
                      stats.revenueChange > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      <TrendingUp className={`h-3 w-3 mr-1 ${
                        stats.revenueChange < 0 ? 'rotate-180' : ''
                      }`} />
                      {stats.revenueChange > 0 ? '+' : ''}{stats.revenueChange}%
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        {/* Carousel dot indicators - mobile only */}
        <div className="flex justify-center gap-1.5 mb-6 md:hidden">
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                activeStatCard === i ? 'w-4 bg-blue-600' : 'w-1.5 bg-muted-foreground/30'
              }`}
              onClick={() => {
                const el = statsScrollRef.current;
                if (!el) return;
                const cardWidth = el.scrollWidth / 4;
                el.scrollTo({ left: cardWidth * i, behavior: 'smooth' });
              }}
              aria-label={`Stat card ${i + 1}`}
            />
          ))}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Main Navigation - Takes 2 columns on large screens */}
          <div className="lg:col-span-2">
            <div className="mb-4 hidden md:block">
              <h2 className="text-2xl font-bold text-foreground mb-2">Accesos Rápidos</h2>
              <p className="text-muted-foreground">Navega a las secciones principales del sistema</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:gap-6">
              {/* Ventas Card */}
              <motion.div {...cardHover}>
              <Link
                href="/ventas"
                className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-blue-300 dark:hover:border-blue-700 overflow-hidden block"
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

              {/* Production Card */}
              <motion.div {...cardHover}>
              <Link
                href="/produccion"
                className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-purple-300 dark:hover:border-purple-700 overflow-hidden block"
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

              {/* Statistics Card */}
              <motion.div {...cardHover}>
              <Link
                href="/estadisticas"
                className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-green-300 dark:hover:border-green-700 overflow-hidden block"
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

              {/* Config Card (if admin) */}
              {session.user?.role === 'MASTER' && (
                <motion.div {...cardHover}>
                <Link
                  href="/config"
                  className="group relative bg-card p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-border hover:border-gray-300 dark:hover:border-gray-600 overflow-hidden block"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-gray-400/10 to-gray-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500 hidden md:block"></div>
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

              {/* Logistics Card — only for logistics admins */}
              {(session.user as any)?.isLogisticsAdmin && (
                <Link
                  href="/logistics"
                  className="group relative bg-gradient-to-br from-[#0D0D0D] to-[#1a1a2e] p-4 md:p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-indigo-900/40 hover:border-indigo-500/60 overflow-hidden"
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
              )}
            </div>
          </div>

          {/* Sidebar: Quick Actions & Alerts */}
          <div className="space-y-6">
            {/* Quick Actions */}
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

            {/* System Info */}
            <Card className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border-blue-200 dark:border-blue-800">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  ¿Nuevo en Betsy?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Configura tu sistema en minutos con nuestro asistente guiado
                </p>
                <Button
                  size="sm"
                  onClick={() => setShowWizardModal(true)}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Iniciar Asistente
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer Section */}
        <footer className="mt-12 text-center text-muted-foreground text-sm">
          <p>© 2024 Betsy CRM</p>
          <p className="mt-1">v1.0.1</p>
        </footer>
      </motion.main>

      {/* Setup Wizard Floating Button (optional - can remove if button in sidebar) */}
      <button
        onClick={() => setShowWizardModal(true)}
        className="fixed right-4 p-4 bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-full shadow-lg hover:shadow-xl transform hover:scale-110 transition-all duration-200 group z-40 lg:hidden"
        style={{ bottom: 'calc(136px + env(safe-area-inset-bottom, 0px))' }}
        title="Asistente de Configuración"
      >
        <Sparkles className="h-6 w-6 animate-pulse" />
      </button>

      <MobileBottomNav />

      {/* Setup Wizard Modal */}
      <Dialog open={showWizardModal} onOpenChange={setShowWizardModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <Sparkles className="h-6 w-6 text-purple-600" />
              Asistente de Configuración
            </DialogTitle>
            <DialogDescription className="text-base">
              Te guiaremos paso a paso para configurar todo tu CRM
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Quick Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-blue-900 dark:text-blue-300">Rápido</h4>
                  <p className="text-sm text-blue-700 dark:text-blue-400">Solo 15-20 minutos</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-purple-50 dark:bg-purple-950/30 rounded-lg">
                <div className="p-2 bg-purple-600 rounded-lg">
                  <Settings className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-purple-900 dark:text-purple-300">Completo</h4>
                  <p className="text-sm text-purple-700 dark:text-purple-400">Configura todo tu sistema</p>
                </div>
              </div>
            </div>

            {/* What will be configured */}
            <div className="bg-muted rounded-lg p-4">
              <h4 className="font-semibold text-foreground mb-3">Lo que configuraremos:</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-blue-600 rounded-full"></div>
                  Información del Negocio
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-blue-600 rounded-full"></div>
                  Campos Personalizados de Productos
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-blue-600 rounded-full"></div>
                  Estados de Pedidos (Flujo de Trabajo)
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-blue-600 rounded-full"></div>
                  Inventario, Clientes y Productos Frecuentes
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 bg-blue-600 rounded-full"></div>
                  Vendedores y Métodos de Envío
                </li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowWizardModal(false)}
                className="flex-1"
              >
                Más Tarde
              </Button>
              <Button
                onClick={() => {
                  setShowWizardModal(false);
                  router.push('/setup-wizard');
                }}
                className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Comenzar Ahora
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
