// src/app/page.tsx
export default function RootPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <main className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">Betsy CRM</h1>
          <p className="text-gray-600 mb-8">Sistema de Gestión</p>
          
          {/* Add your meta verification tags here if needed */}
          
          <div className="max-w-2xl mx-auto">
            <p className="text-gray-600 mb-4">
              Bienvenido a Betsy CRM, tu solución integral para gestión empresarial.
            </p>
            
            <a
              href="/home"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Acceder al Sistema
            </a>
          </div>
        </div>

        <footer className="mt-16 text-center text-gray-500 text-sm">
          <p>© 2025 Betsy CRM.</p>
          <p>otro dia, otro dolar </p>
          <p>v1.0.1 </p>
        </footer>
      </main>
    </div>
  );
}