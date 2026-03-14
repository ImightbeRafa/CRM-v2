import Link from 'next/link';
import { getAllDocs } from '@/lib/docs';
import {
  BookOpen, Rocket, Truck, Code, HelpCircle, Clock, ArrowRight,
} from 'lucide-react';
import { DocsIndexClient } from './DocsIndexClient';

export const dynamic = 'force-static';
export const revalidate = 3600;

const CATEGORY_LABELS: Record<string, string> = {
  'getting-started': 'Primeros Pasos',
  'shipping': 'Envíos',
  'integraciones': 'Integraciones',
  'api': 'API',
  'general': 'General',
};

const CATEGORY_COLORS: Record<string, { iconBg: string; text: string }> = {
  'getting-started': { iconBg: 'bg-blue-100', text: 'text-blue-700' },
  'shipping': { iconBg: 'bg-orange-100', text: 'text-orange-700' },
  'api': { iconBg: 'bg-violet-100', text: 'text-violet-700' },
  'general': { iconBg: 'bg-sky-100', text: 'text-sky-700' },
  'integraciones': { iconBg: 'bg-indigo-100', text: 'text-indigo-700' },
};

function getCategoryIcon(cat: string) {
  const icons: Record<string, React.ReactNode> = {
    'getting-started': <Rocket className="h-5 w-5" />,
    'shipping': <Truck className="h-5 w-5" />,
    'api': <Code className="h-5 w-5" />,
    'general': <HelpCircle className="h-5 w-5" />,
  };
  return icons[cat] || <BookOpen className="h-5 w-5" />;
}

export default function DocsIndex() {
  const docs = getAllDocs('public');
  const categories = Array.from(new Set(docs.map(d => d.category)));

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-4 shadow-lg shadow-blue-200">
          <BookOpen className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Documentación de BetsyCRM</h1>
        <p className="text-gray-500 max-w-lg mx-auto">
          Guías paso a paso para configurar y aprovechar al máximo tu CRM.
        </p>
      </div>

      {/* Search */}
      <DocsIndexClient docs={docs} />

      {/* CTA Banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 mb-10 text-white text-center">
        <h2 className="text-xl font-bold mb-2">¿Aún no tienes cuenta?</h2>
        <p className="text-blue-100 mb-4">Prueba BetsyCRM gratis por 15 días. Sin tarjeta de crédito.</p>
        <Link
          href="/auth/signin"
          className="inline-flex items-center gap-2 bg-white text-blue-600 font-semibold px-6 py-2.5 rounded-lg hover:bg-blue-50 transition-colors"
        >
          Empezar Gratis <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Docs by category */}
      {categories.map(cat => {
        const catDocs = docs.filter(d => d.category === cat);
        if (catDocs.length === 0) return null;
        const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS['general'];
        return (
          <div key={cat} className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-lg ${colors.iconBg} ${colors.text}`}>
                {getCategoryIcon(cat)}
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {CATEGORY_LABELS[cat] || cat}
                </h2>
                <p className="text-xs text-gray-400">{catDocs.length} {catDocs.length === 1 ? 'artículo' : 'artículos'}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {catDocs.map(doc => (
                <Link
                  key={doc.slug}
                  href={`/docs/${doc.slug}`}
                  className="group flex items-start gap-3 border rounded-xl p-4 hover:shadow-md hover:border-blue-200 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors text-sm mb-1">
                      {doc.title}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-2">{doc.description}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {doc.readingTime}m
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {docs.length === 0 && (
        <div className="text-center py-16 border rounded-2xl bg-gray-50">
          <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Estamos preparando la documentación. Vuelve pronto.</p>
        </div>
      )}
    </div>
  );
}
