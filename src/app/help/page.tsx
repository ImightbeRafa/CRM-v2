import Link from 'next/link';
import { getHelpDocs } from '@/lib/help-docs';
import {
  BookOpen, Rocket, Truck, Code, Settings, CreditCard,
  HelpCircle, ShoppingCart, Factory, BarChart3, Plug, Clock, ArrowRight,
} from 'lucide-react';
import { HelpIndexClient } from './HelpIndexClient';

export const dynamic = 'force-static';
export const revalidate = 3600;

const CATEGORY_LABELS: Record<string, string> = {
  'getting-started': 'Primeros Pasos',
  'shipping': 'Envíos',
  'integraciones': 'Integraciones',
  'api': 'API',
  'general': 'General',
  'config': 'Configuración',
  'billing': 'Facturación',
  'ventas': 'Ventas',
  'produccion': 'Producción',
  'estadisticas': 'Estadísticas',
};

const CATEGORY_TINT: Record<string, string> = {
  'getting-started': 'bg-[#F1EEFF] text-[#5B3FE0]',
  'shipping': 'bg-orange-50 text-orange-700',
  'api': 'bg-violet-50 text-violet-700',
  'config': 'bg-slate-100 text-slate-600',
  'billing': 'bg-emerald-50 text-emerald-700',
  'general': 'bg-sky-50 text-sky-700',
  'ventas': 'bg-pink-50 text-pink-700',
  'produccion': 'bg-amber-50 text-amber-700',
  'estadisticas': 'bg-cyan-50 text-cyan-700',
  'integraciones': 'bg-indigo-50 text-indigo-700',
};

function getCategoryIcon(cat: string) {
  const icons: Record<string, React.ReactNode> = {
    'getting-started': <Rocket className="h-5 w-5" />,
    'shipping': <Truck className="h-5 w-5" />,
    'api': <Code className="h-5 w-5" />,
    'config': <Settings className="h-5 w-5" />,
    'billing': <CreditCard className="h-5 w-5" />,
    'general': <HelpCircle className="h-5 w-5" />,
    'ventas': <ShoppingCart className="h-5 w-5" />,
    'produccion': <Factory className="h-5 w-5" />,
    'estadisticas': <BarChart3 className="h-5 w-5" />,
    'integraciones': <Plug className="h-5 w-5" />,
  };
  return icons[cat] || <BookOpen className="h-5 w-5" />;
}

export default function HelpIndex() {
  const docs = getHelpDocs();
  const categories = Array.from(new Set(docs.map(d => d.category)));

  const featuredDoc = docs.find(d => d.category === 'getting-started');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Hero */}
      <div className="mb-8">
        <h1 className="mb-1 text-[20px] font-semibold text-slate-900">¿En qué te ayudamos?</h1>
        <p className="max-w-lg text-[14px] text-slate-500">
          Guías y tutoriales para usar todas las funciones de BetsyCRM. Encontrá respuestas rápidas a tus preguntas.
        </p>
      </div>

      {/* Search */}
      <HelpIndexClient docs={docs} />

      {/* Featured Card */}
      {featuredDoc && (
        <Link
          href={`/help/${featuredDoc.slug}`}
          className="group mb-8 block rounded-2xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] p-6 text-white shadow-sm transition-opacity hover:opacity-95"
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="mb-3 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">
                Comenzá acá
              </span>
              <h2 className="mb-2 text-xl font-bold">{featuredDoc.title}</h2>
              <p className="max-w-md text-sm text-white/80">{featuredDoc.description}</p>
            </div>
            <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-white/60 transition-all group-hover:translate-x-1 group-hover:text-white" />
          </div>
        </Link>
      )}

      {/* Categories Grid */}
      {categories.map(cat => {
        const catDocs = docs.filter(d => d.category === cat);
        if (catDocs.length === 0) return null;
        const tint = CATEGORY_TINT[cat] || CATEGORY_TINT['general'];
        return (
          <section key={cat} className="mb-8">
            <div className="mb-3 flex items-center gap-3">
              <div className={`rounded-lg p-2 ${tint}`}>
                {getCategoryIcon(cat)}
              </div>
              <div>
                <h2 className="text-[16px] font-semibold text-slate-900">
                  {CATEGORY_LABELS[cat] || cat}
                </h2>
                <p className="text-xs text-slate-500">{catDocs.length} {catDocs.length === 1 ? 'artículo' : 'artículos'}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {catDocs.map(doc => (
                <Link
                  key={doc.slug}
                  href={`/help/${doc.slug}`}
                  className="group flex items-start gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition-all hover:border-[#C9BFFF] hover:shadow-md"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-1 text-sm font-medium text-slate-900 transition-colors group-hover:text-[#5B3FE0]">
                      {doc.title}
                    </h3>
                    <p className="line-clamp-2 text-xs text-slate-500">{doc.description}</p>
                  </div>
                  <div className="mt-0.5 flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                    <Clock className="h-3 w-3" />
                    {doc.readingTime}m
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      {docs.length === 0 && (
        <div className="rounded-2xl border border-slate-200/70 bg-white py-16 text-center shadow-sm">
          <BookOpen className="mx-auto mb-4 h-12 w-12 text-slate-300" />
          <p className="text-slate-500">Estamos preparando las guías de ayuda. Volvé pronto.</p>
        </div>
      )}
    </div>
    </div>
  );
}
