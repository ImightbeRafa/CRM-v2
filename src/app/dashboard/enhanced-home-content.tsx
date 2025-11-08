'use client';
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import LogoutButton from "@/app/components/LogoutButton";
import BetsyLogo from "@/BetsyLogo.png";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";
import { 
  Sparkles, Zap, Settings, TrendingUp, Users, Package, 
  ShoppingCart, Plus, BarChart3, DollarSign, ArrowUpRight, Clock
} from "lucide-react";

export default function EnhancedHomeContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [stats, setStats] = useState({
    ordersWeek: 0,
    pendingOrders: 0,
    totalClients: 0,
    weeklyRevenue: 0,
    ordersChange: 0,
    newClientsThisWeek: 0,
    revenueChange: 0
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  // Fetch quick stats
  useEffect(() => {
    if (session) {
      const fetchStats = async () => {
        try {
          setIsLoadingStats(true);
          const response = await fetch('/api/dashboard/stats');
          if (response.ok) {
            const data = await response.json();
            setStats(data);
          } else {
            console.error('Failed to fetch dashboard stats');
          }
        } catch (error) {
          console.error('Error fetching dashboard stats:', error);
        } finally {
          setIsLoadingStats(false);
        }
      };
      
      fetchStats();
    }
  }, [session]);

  // Show loading state while checking authentication
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, show sign in prompt
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <Image 
              src={BetsyLogo} 
              alt="Betsy CRM" 
              width={80}
              height={80}
              className="object-contain"
              priority
            />
          </div>
          
          <p className="text-gray-600 mb-8">Por favor, inicia sesión para continuar</p>
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
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <main className="container mx-auto px-4 md:px-6 py-6 md:py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-8">
          <div className="flex-1 flex items-center gap-3">
            <Image 
              src={BetsyLogo} 
              alt="Betsy CRM" 
              width={56}
              height={56}
              className="object-contain flex-shrink-0"
              style={{ width: 'auto', height: '3rem' }}
              priority
            />
            <div>
              <p className="text-sm md:text-base text-gray-600">Sistema de Gestión</p>
              <div className="flex items-center gap-2">
                <p className="text-xs md:text-sm text-gray-500 truncate max-w-[200px] sm:max-w-none">
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
            {session.user?.role === 'MASTER' && (
              <Link
                href="/config"
                className="inline-flex items-center justify-center bg-gray-800 text-white px-3 md:px-4 py-2.5 md:py-2 rounded-md hover:bg-gray-900 transition-colors text-sm md:text-base min-h-[44px]"
              >
                <Settings className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Configuración</span>
              </Link>
            )}
            <LogoutButton />
          </div>
        </div>

        {/* Quick Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
          <Card className="border-l-4 border-l-blue-600">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-gray-600">
                <ShoppingCart className="h-4 w-4" />
                Pedidos Esta Semana
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline justify-between">
                <p className="text-3xl font-bold text-gray-900">{isLoadingStats ? '...' : stats.ordersWeek}</p>
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

          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-gray-600">
                <Clock className="h-4 w-4" />
                Pendientes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline justify-between">
                <p className="text-3xl font-bold text-gray-900">{isLoadingStats ? '...' : stats.pendingOrders}</p>
                {stats.pendingOrders > 0 && (
                  <Link href="/ventas?status=pending" className="text-orange-600 text-sm hover:underline">
                    Ver →
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-600">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-gray-600">
                <Users className="h-4 w-4" />
                Total Clientes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline justify-between">
                <p className="text-3xl font-bold text-gray-900">{isLoadingStats ? '...' : stats.totalClients}</p>
                {!isLoadingStats && stats.newClientsThisWeek > 0 && (
                  <span className="text-purple-600 text-sm flex items-center">
                    <ArrowUpRight className="h-3 w-3 mr-1" />
                    +{stats.newClientsThisWeek}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-600">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-gray-600">
                <DollarSign className="h-4 w-4" />
                Ventas Esta Semana
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline justify-between">
                <p className="text-2xl font-bold text-gray-900">
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

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Main Navigation - Takes 2 columns on large screens */}
          <div className="lg:col-span-2">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Accesos Rápidos</h2>
              <p className="text-gray-600">Navega a las secciones principales del sistema</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Ventas Card */}
              <Link
                href="/ventas"
                className="group relative bg-white p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-gray-100 hover:border-blue-300 overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-400/10 to-blue-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                      <ShoppingCart className="w-7 h-7 text-white" />
                    </div>
                    <ArrowUpRight className="w-6 h-6 text-blue-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Ventas</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Gestionar pedidos y clientes</p>
                </div>
              </Link>

              {/* Production Card */}
              <Link
                href="/produccion"
                className="group relative bg-white p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-gray-100 hover:border-purple-300 overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-purple-400/10 to-purple-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-4 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                      <Package className="w-7 h-7 text-white" />
                    </div>
                    <ArrowUpRight className="w-6 h-6 text-purple-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Producción</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Gestionar producción y órdenes</p>
                </div>
              </Link>

              {/* Statistics Card */}
              <Link
                href="/estadisticas"
                className="group relative bg-white p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-gray-100 hover:border-green-300 overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-400/10 to-green-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-4 bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                      <BarChart3 className="w-7 h-7 text-white" />
                    </div>
                    <ArrowUpRight className="w-6 h-6 text-green-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Estadísticas</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Análisis y reportes detallados</p>
                </div>
              </Link>

              {/* Config Card (if admin) */}
              {session.user?.role === 'MASTER' && (
                <Link
                  href="/config"
                  className="group relative bg-white p-8 rounded-2xl hover:shadow-2xl transition-all duration-300 border-2 border-gray-100 hover:border-gray-300 overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-gray-400/10 to-gray-600/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
                  <div className="relative">
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-4 bg-gradient-to-br from-gray-700 to-gray-900 rounded-xl shadow-lg group-hover:shadow-xl transition-shadow">
                        <Settings className="w-7 h-7 text-white" />
                      </div>
                      <ArrowUpRight className="w-6 h-6 text-gray-800 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Configuración</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">Ajustes del sistema</p>
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
                <Link href="/ventas" className="w-full">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Nuevo Pedido
                  </Button>
                </Link>
                
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
            <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  ¿Nuevo en Betsy?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700 mb-3">
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
        <footer className="mt-12 text-center text-gray-500 text-sm">
          <p>© 2024 Betsy CRM</p>
          <p className="mt-1">v1.0.1</p>
        </footer>
      </main>

      {/* Setup Wizard Floating Button (optional - can remove if button in sidebar) */}
      <button
        onClick={() => setShowWizardModal(true)}
        className="fixed bottom-6 right-6 p-4 bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-full shadow-lg hover:shadow-xl transform hover:scale-110 transition-all duration-200 group z-50 lg:hidden"
        title="Asistente de Configuración"
      >
        <Sparkles className="h-6 w-6 animate-pulse" />
      </button>

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
              <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                <div className="p-2 bg-blue-600 rounded-lg">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-blue-900">Rápido</h4>
                  <p className="text-sm text-blue-700">Solo 15-20 minutos</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-purple-50 rounded-lg">
                <div className="p-2 bg-purple-600 rounded-lg">
                  <Settings className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold text-purple-900">Completo</h4>
                  <p className="text-sm text-purple-700">Configura todo tu sistema</p>
                </div>
              </div>
            </div>

            {/* What will be configured */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-3">Lo que configuraremos:</h4>
              <ul className="space-y-2 text-sm text-gray-700">
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
