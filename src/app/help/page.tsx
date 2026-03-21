import Link from 'next/link';
import { getAllDocs } from '@/lib/docs';
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

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
  'getting-started': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', iconBg: 'bg-blue-100' },
  'shipping': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', iconBg: 'bg-orange-100' },
  'api': { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', iconBg: 'bg-violet-100' },
  'config': { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border', iconBg: 'bg-muted' },
  'billing': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', iconBg: 'bg-emerald-100' },
  'general': { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', iconBg: 'bg-sky-100' },
  'ventas': { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', iconBg: 'bg-pink-100' },
  'produccion': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', iconBg: 'bg-amber-100' },
  'estadisticas': { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', iconBg: 'bg-cyan-100' },
  'integraciones': { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', iconBg: 'bg-indigo-100' },
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
  const docs = getAllDocs('private');
  const categories = Array.from(new Set(docs.map(d => d.category)));

  const featuredDoc = docs.find(d => d.category === 'getting-started');

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mb-4 shadow-lg shadow-blue-200">
          <BookOpen className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Centro de Ayuda</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Guías y tutoriales para usar todas las funciones de BetsyCRM. Encuentra respuestas rápidas a tus preguntas.
        </p>
      </div>

      {/* Search */}
      <HelpIndexClient docs={docs} />

      {/* Featured Card */}
      {featuredDoc && (
        <Link
          href={`/help/${featuredDoc.slug}`}
          className="group block mb-10 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white hover:shadow-xl hover:shadow-blue-200/50 transition-all"
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="inline-block px-2.5 py-0.5 text-xs font-medium bg-white/20 rounded-full mb-3">
                Comienza aquí
              </span>
              <h2 className="text-xl font-bold mb-2">{featuredDoc.title}</h2>
              <p className="text-blue-100 text-sm max-w-md">{featuredDoc.description}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0 mt-1" />
          </div>
        </Link>
      )}

      {/* Categories Grid */}
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
                <h2 className="text-lg font-bold text-foreground">
                  {CATEGORY_LABELS[cat] || cat}
                </h2>
                <p className="text-xs text-muted-foreground">{catDocs.length} {catDocs.length === 1 ? 'artículo' : 'artículos'}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {catDocs.map(doc => (
                <Link
                  key={doc.slug}
                  href={`/help/${doc.slug}`}
                  className="group flex items-start gap-3 bg-card border border-border rounded-xl p-4 hover:shadow-md hover:border-blue-200 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-foreground group-hover:text-blue-600 transition-colors text-sm mb-1">
                      {doc.title}
                    </h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 mt-0.5">
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
        <div className="text-center py-16 border rounded-2xl bg-muted">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Estamos preparando las guías de ayuda. Vuelve pronto.</p>
        </div>
      )}
    </div>
  );
}
