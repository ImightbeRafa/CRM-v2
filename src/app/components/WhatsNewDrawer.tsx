'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  Sparkles,
  X,
  Bug,
  Lightbulb,
  Wrench,
  Megaphone,
  Bell,
} from 'lucide-react';
import { Badge } from './ui/badge';

interface ChangelogEntry {
  id: string;
  title: string;
  description: string;
  category: string;
  createdAt: string;
}

const CATEGORY_CONFIG: Record<string, { icon: React.ComponentType<any>; label: string; color: string }> = {
  feature: { icon: Sparkles, label: 'Nueva Función', color: 'bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  fix: { icon: Bug, label: 'Corrección', color: 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800' },
  improvement: { icon: Wrench, label: 'Mejora', color: 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800' },
  announcement: { icon: Megaphone, label: 'Anuncio', color: 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
};

const SEEN_KEY = 'betsy-changelog-seen';

export function WhatsNewDrawer() {
  const { data: session, status } = useSession();
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    loadEntries();
  }, [status]);

  const loadEntries = async () => {
    try {
      const res = await fetch('/api/changelog', { credentials: 'include' });
      const data = await res.json();
      if (data.status === 'success' && data.data?.length > 0) {
        setEntries(data.data);
        const lastSeen = localStorage.getItem(SEEN_KEY);
        const newestDate = data.data[0].createdAt;
        if (!lastSeen || new Date(newestDate) > new Date(lastSeen)) {
          setHasNew(true);
        }
      }
    } catch { /* ignore */ }
    finally { setLoaded(true); }
  };

  const handleOpen = () => {
    setIsOpen(true);
    setHasNew(false);
    if (entries.length > 0) {
      localStorage.setItem(SEEN_KEY, entries[0].createdAt);
    }
  };

  if (status !== 'authenticated' || !loaded || entries.length === 0) return null;

  return (
    <>
      {/* Bell icon trigger */}
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
        aria-label="Novedades"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {hasNew && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-blue-600 rounded-full ring-2 ring-background animate-pulse" />
        )}
      </button>

      {/* Drawer overlay */}
      {isOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-50" onClick={() => setIsOpen(false)} />
          <div className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg font-bold text-foreground">Novedades</h2>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            {/* Entries */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {entries.map(entry => {
                const config = CATEGORY_CONFIG[entry.category] || CATEGORY_CONFIG.improvement;
                const Icon = config.icon;
                return (
                  <div key={entry.id} className="border border-border rounded-xl p-4 hover:bg-muted transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className={`text-[10px] ${config.color}`}>
                        <Icon className="h-3 w-3 mr-1" />
                        {config.label}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    <h3 className="font-semibold text-foreground text-sm mb-1">{entry.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{entry.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
