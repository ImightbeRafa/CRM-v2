import Link from 'next/link';
import { BookOpen } from 'lucide-react';

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              &larr; Dashboard
            </Link>
            <div className="w-px h-5 bg-gray-200" />
            <Link href="/help" className="flex items-center gap-2 text-base font-bold text-gray-900 hover:text-blue-600 transition-colors">
              <BookOpen className="h-5 w-5 text-blue-600" />
              Centro de Ayuda
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col">
        {children}
      </div>
    </div>
  );
}
