'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import {
  MessageCircleQuestion,
  X,
  Send,
  Bug,
  Lightbulb,
  HelpCircle,
  MoreHorizontal,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';

interface Ticket {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  adminNotes: string | null;
  priority: string;
  createdAt: string;
  resolvedAt: string | null;
}

const CATEGORIES = [
  { id: 'bug', label: 'Error / Bug', icon: Bug, color: 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100' },
  { id: 'feature', label: 'Sugerencia', icon: Lightbulb, color: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' },
  { id: 'question', label: 'Pregunta', icon: HelpCircle, color: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100' },
  { id: 'other', label: 'Otro', icon: MoreHorizontal, color: 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100' },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'Abierto', color: 'bg-blue-100 text-blue-800' },
  in_progress: { label: 'En Progreso', color: 'bg-amber-100 text-amber-800' },
  resolved: { label: 'Resuelto', color: 'bg-green-100 text-green-800' },
  closed: { label: 'Cerrado', color: 'bg-gray-100 text-gray-800' },
};

const EXCLUDED_PATHS = ['/home', '/landing', '/auth', '/terms', '/privacy', '/setup-wizard', '/setup-tenant', '/docs'];

export function FeedbackWidget() {
  const { data: session, status: authStatus } = useSession();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'form' | 'tickets'>('form');
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);

  const isExcluded = EXCLUDED_PATHS.some(p => pathname?.startsWith(p));
  if (authStatus !== 'authenticated' || isExcluded) return null;

  const resetForm = () => {
    setCategory('');
    setSubject('');
    setDescription('');
    setSent(false);
  };

  const loadTickets = async () => {
    setLoadingTickets(true);
    try {
      const res = await fetch('/api/feedback', { credentials: 'include' });
      const data = await res.json();
      if (data.status === 'success') setTickets(data.data || []);
    } catch { /* ignore */ }
    finally { setLoadingTickets(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !subject.trim() || !description.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ category, subject: subject.trim(), description: description.trim() }),
      });
      if (res.ok) {
        setSent(true);
        setTimeout(() => { resetForm(); setView('tickets'); loadTickets(); }, 1500);
      }
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (view === 'tickets') loadTickets();
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center group"
          aria-label="Enviar feedback"
        >
          <MessageCircleQuestion className="h-5 w-5 group-hover:scale-110 transition-transform" />
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-h-[520px] bg-white rounded-2xl shadow-2xl border flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex gap-1">
              <button
                onClick={() => { setView('form'); resetForm(); }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${view === 'form' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Nuevo
              </button>
              <button
                onClick={() => { setView('tickets'); loadTickets(); }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${view === 'tickets' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Mis Tickets
              </button>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/60 rounded-md transition-colors">
              <X className="h-4 w-4 text-gray-500" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {view === 'form' ? (
              sent ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900">¡Gracias por tu feedback!</h3>
                  <p className="text-sm text-gray-500 mt-1">Lo revisaremos lo antes posible.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Category */}
                  <div>
                    <Label className="text-xs font-medium text-gray-600 mb-1.5 block">Categoría</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {CATEGORIES.map(cat => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategory(cat.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                            category === cat.id ? cat.color + ' ring-1 ring-current' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          <cat.icon className="h-4 w-4" />
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <Label htmlFor="fb-subject" className="text-xs font-medium text-gray-600">Asunto</Label>
                    <Input
                      id="fb-subject"
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder="Resumen breve del tema"
                      maxLength={200}
                      className="mt-1"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <Label htmlFor="fb-desc" className="text-xs font-medium text-gray-600">Descripción</Label>
                    <textarea
                      id="fb-desc"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe el problema o sugerencia con detalle..."
                      rows={4}
                      maxLength={5000}
                      className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={!category || !subject.trim() || !description.trim() || sending}
                    className="w-full"
                  >
                    {sending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-2" />Enviar Feedback</>
                    )}
                  </Button>
                </form>
              )
            ) : (
              /* Tickets list */
              loadingTickets ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : tickets.length === 0 ? (
                <div className="text-center py-8">
                  <MessageCircleQuestion className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No has enviado tickets aún.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tickets.map(t => {
                    const statusInfo = STATUS_LABELS[t.status] || STATUS_LABELS.open;
                    const isExpanded = expandedTicket === t.id;
                    return (
                      <div key={t.id} className="border rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpandedTicket(isExpanded ? null : t.id)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">{t.subject}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="secondary" className={`text-[10px] ${statusInfo.color}`}>
                                  {statusInfo.label}
                                </Badge>
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" />
                                  {new Date(t.createdAt).toLocaleDateString('es-CR')}
                                </span>
                              </div>
                            </div>
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="px-3 pb-3 pt-1 border-t bg-gray-50 space-y-2">
                            <p className="text-xs text-gray-600">{t.description}</p>
                            {t.adminNotes && (
                              <div className="bg-blue-50 border border-blue-200 rounded-md p-2">
                                <p className="text-[10px] font-medium text-blue-700 mb-0.5">Respuesta del equipo:</p>
                                <p className="text-xs text-blue-800">{t.adminNotes}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </>
  );
}
