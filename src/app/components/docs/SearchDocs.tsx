'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, X, CornerDownLeft } from 'lucide-react';
import type { DocMeta } from '@/lib/docs';

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

interface SearchDocsProps {
  docs: DocMeta[];
  basePath: string;
}

function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors w-full max-w-xs"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Buscar...</span>
      <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-white border rounded">
        Ctrl K
      </kbd>
    </button>
  );
}

function SearchModal({ docs, basePath, onClose }: SearchDocsProps & { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const filtered = query.trim()
    ? docs.filter(d => {
        const q = query.toLowerCase();
        return d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q);
      })
    : docs;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const navigate = useCallback((slug: string) => {
    onClose();
    router.push(`${basePath}/${slug}`);
  }, [router, basePath, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      navigate(filtered[selectedIndex].slug);
    }
  };

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-w-lg mx-auto mt-[15vh]">
        <div className="bg-white rounded-xl shadow-2xl border overflow-hidden mx-4">
          <div className="flex items-center gap-3 px-4 border-b">
            <Search className="h-5 w-5 text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Buscar en la documentación..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              className="flex-1 py-3.5 text-sm bg-transparent outline-none placeholder:text-gray-400"
            />
            <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100">
              <X className="h-4 w-4 text-gray-400" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                No se encontraron resultados para &ldquo;{query}&rdquo;
              </div>
            ) : (
              filtered.map((doc, i) => (
                <button
                  key={doc.slug}
                  onClick={() => navigate(doc.slug)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`
                    w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors
                    ${i === selectedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'}
                  `}
                >
                  <FileText className={`h-4 w-4 mt-0.5 shrink-0 ${i === selectedIndex ? 'text-blue-600' : 'text-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${i === selectedIndex ? 'text-blue-700' : 'text-gray-900'}`}>
                      {doc.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{doc.description}</p>
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 mt-1">
                    {CATEGORY_LABELS[doc.category] || doc.category}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center gap-4 px-4 py-2 border-t bg-gray-50 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" /> Seleccionar
            </span>
            <span>↑↓ Navegar</span>
            <span>Esc Cerrar</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SearchDocsWrapper({ docs, basePath }: SearchDocsProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <SearchTrigger onClick={() => setOpen(true)} />
      {open && <SearchModal docs={docs} basePath={basePath} onClose={() => setOpen(false)} />}
    </>
  );
}
