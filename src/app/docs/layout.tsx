import Link from 'next/link';
import { BookOpen } from 'lucide-react';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-card flex flex-col">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/docs" className="flex items-center gap-2 text-base font-bold text-foreground hover:text-blue-600 transition-colors">
            <BookOpen className="h-5 w-5 text-blue-600" />
            BetsyCRM Docs
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/home" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Inicio
            </Link>
            <Link
              href="/auth/signin"
              className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Iniciar sesión
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col">
        {children}
      </div>

      <footer className="border-t bg-muted py-8 mt-16">
        <div className="max-w-[1400px] mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} BetsyCRM. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
