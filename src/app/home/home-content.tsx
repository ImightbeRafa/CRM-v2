'use client';
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LogoutButton from "@/app/components/LogoutButton";

export default function HomeContent() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Show loading state while checking authentication
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
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
          <h1 className="text-4xl font-bold text-gray-800 mb-4">Betsy CRM</h1>
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
      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Betsy CRM</h1>
            <p className="text-gray-600">Sistema de Gestión</p>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-sm text-gray-500">Bienvenido, {session.user?.email}</p>
              {session.user?.role === 'MASTER' && (
                <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full font-bold">
                  M
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {session.user?.role === 'MASTER' && (
              <Link
                href="/config"
                className="inline-block bg-gray-800 text-white px-4 py-2 rounded-md hover:bg-gray-900 transition-colors"
              >
                Configuración
              </Link>
            )}
            <LogoutButton />
          </div>
        </div>

        {/* Main Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {/* Ventas Card */}
          <Link
            href="/ventas"
            className="group bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 border border-gray-200"
          >
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                <svg
                  className="w-8 h-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">Ventas</h2>
              <p className="text-gray-600 text-center text-sm">Gestionar pedidos y clientes</p>
            </div>
          </Link>

          {/* Production Card */}
          <Link
            href="/produccion"
            className="group bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 border border-gray-200"
          >
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                <svg
                  className="w-8 h-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-600 mb-2">Producción</h2>
              <p className="text-gray-500 text-center text-sm">Gestionar producción y órdenes</p>
            </div>
          </Link>

          {/* Statistics Card */}
          <Link
            href="/estadisticas"
            className="group bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 border border-gray-200"
          >
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                <svg
                  className="w-8 h-8 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-600 mb-2">Estadísticas</h2>
              <p className="text-gray-500 text-center text-sm">Data en tiempo real</p>
            </div>
          </Link>
        </div>

        {/* Footer Section */}
        <footer className="mt-16 text-center text-gray-500 text-sm">
          <p>© 2024 Betsy CRM. Hecho por Rafael Garcia Montoya:) </p>
          <p>otro dia, otro dolar </p>
          <p>v1.1.1 </p>
        </footer>
      </main>
    </div>
  );
}