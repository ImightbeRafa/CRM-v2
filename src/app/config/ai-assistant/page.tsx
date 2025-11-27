'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Bot, 
  MessageCircle, 
  Link2, 
  Link2Off, 
  Copy, 
  Check, 
  RefreshCw,
  ExternalLink,
  Shield,
  Clock,
  User,
  ArrowLeft,
  Zap,
  AlertCircle,
  Sparkles
} from 'lucide-react';

interface ConnectionStatus {
  telegram: {
    connected: boolean;
    displayName?: string;
    username?: string;
    connectedAt?: string;
    sessionId?: string;
  };
  whatsapp: {
    connected: boolean;
    comingSoon?: boolean;
  };
}

interface BotSession {
  id: string;
  platform: string;
  displayName: string;
  username?: string;
  connectedAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export default function AIAssistantPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [sessions, setSessions] = useState<BotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOwnerOrAdmin, setIsOwnerOrAdmin] = useState(false);

  // Load connection status
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/telegram/connect');
      if (res.ok) {
        const data = await res.json();
        setStatus(data.data);
      }
    } catch (err) {
      console.error('Error loading status:', err);
    }
  }, []);

  // Load all sessions (for admins)
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/telegram/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.data || []);
        setIsOwnerOrAdmin(true);
      } else if (res.status === 403) {
        setIsOwnerOrAdmin(false);
      }
    } catch (err) {
      console.error('Error loading sessions:', err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadStatus(), loadSessions()]);
      setLoading(false);
    };
    init();
  }, [loadStatus, loadSessions]);

  // Generate connection link
  const handleGenerateLink = async () => {
    setGenerating(true);
    setError(null);
    setDeepLink(null);
    
    try {
      const res = await fetch('/api/bot/telegram/connect', {
        method: 'POST',
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setDeepLink(data.data.deepLink);
      } else {
        setError(data.message || 'Error al generar enlace');
      }
    } catch (err) {
      setError('Error de conexión');
    } finally {
      setGenerating(false);
    }
  };

  // Disconnect Telegram
  const handleDisconnect = async () => {
    if (!confirm('¿Estás seguro de que quieres desconectar Telegram?')) return;
    
    try {
      const res = await fetch('/api/bot/telegram/connect?platform=telegram', {
        method: 'DELETE',
      });
      
      if (res.ok) {
        await loadStatus();
        setDeepLink(null);
      }
    } catch (err) {
      console.error('Error disconnecting:', err);
    }
  };

  // Copy link to clipboard
  const handleCopyLink = async () => {
    if (!deepLink) return;
    
    await navigator.clipboard.writeText(deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Disconnect a session (admin)
  const handleDisconnectSession = async (sessionId: string) => {
    if (!confirm('¿Desconectar esta sesión?')) return;
    
    try {
      const res = await fetch(`/api/bot/telegram/sessions?sessionId=${sessionId}`, {
        method: 'DELETE',
      });
      
      if (res.ok) {
        await loadSessions();
        await loadStatus();
      }
    } catch (err) {
      console.error('Error disconnecting session:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-64 bg-gray-200 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Back Button */}
        <a
          href="/config"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-white/50 rounded-lg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a Configuración
        </a>

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 rounded-2xl p-6 md:p-8 text-white shadow-xl">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
              <Bot className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-bold mb-2 flex items-center gap-2">
                Betsy AI Assistant
                <Sparkles className="h-6 w-6 text-yellow-300" />
              </h1>
              <p className="text-indigo-100 text-sm md:text-base">
                Gestiona tu negocio con comandos de voz natural en Telegram. 
                Crea órdenes, consulta inventario y revisa estadísticas con solo escribir.
              </p>
            </div>
          </div>
        </div>

        {/* Telegram Connection Card */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500 to-cyan-500 p-4 text-white">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <MessageCircle className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Telegram</h2>
                <p className="text-blue-100 text-sm">Conecta tu cuenta de Telegram para usar el bot</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {status?.telegram.connected ? (
              /* Connected State */
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                  <div className="p-2 bg-green-100 rounded-full">
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-green-800">Conectado</p>
                    <p className="text-sm text-green-600">
                      {status.telegram.displayName}
                      {status.telegram.username && ` (@${status.telegram.username})`}
                    </p>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Link2Off className="h-4 w-4" />
                    Desconectar
                  </button>
                </div>

                {status.telegram.connectedAt && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock className="h-4 w-4" />
                    Conectado desde: {new Date(status.telegram.connectedAt).toLocaleDateString('es-CR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}

                <div className="p-4 bg-blue-50 rounded-xl">
                  <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    ¿Cómo usar el bot?
                  </h3>
                  <p className="text-sm text-blue-700 mb-3">
                    Abre Telegram y busca tu chat con @BetsyAIBot. Escribe en lenguaje natural:
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1.5">
                    <li>• "Muéstrame las órdenes de hoy"</li>
                    <li>• "Crea orden para María, 2 camisetas, ₡15000"</li>
                    <li>• "¿Cuánto vendí esta semana?"</li>
                    <li>• "Busca el stock de hoodies"</li>
                  </ul>
                </div>
              </div>
            ) : (
              /* Not Connected State */
              <div className="space-y-4">
                {!deepLink ? (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center p-4 bg-gray-100 rounded-full mb-4">
                      <MessageCircle className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      No estás conectado a Telegram
                    </h3>
                    <p className="text-gray-600 mb-6 max-w-md mx-auto">
                      Genera un enlace mágico para conectar tu cuenta de Telegram 
                      y empezar a usar el asistente AI.
                    </p>
                    <button
                      onClick={handleGenerateLink}
                      disabled={generating}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-cyan-600 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {generating ? (
                        <RefreshCw className="h-5 w-5 animate-spin" />
                      ) : (
                        <Link2 className="h-5 w-5" />
                      )}
                      {generating ? 'Generando...' : 'Generar Enlace de Conexión'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <h3 className="font-semibold text-blue-900 mb-2">
                        ¡Enlace generado! Sigue estos pasos:
                      </h3>
                      <ol className="text-sm text-blue-700 space-y-2">
                        <li className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                          Haz clic en el botón de abajo para abrir Telegram
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                          Presiona "Start" o "Iniciar" en el chat con BetsyAIBot
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                          ¡Listo! Tu cuenta quedará vinculada automáticamente
                        </li>
                      </ol>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-cyan-600 transition-all shadow-lg hover:shadow-xl"
                      >
                        <ExternalLink className="h-5 w-5" />
                        Abrir en Telegram
                      </a>
                      <button
                        onClick={handleCopyLink}
                        className="inline-flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                      >
                        {copied ? (
                          <>
                            <Check className="h-5 w-5 text-green-500" />
                            ¡Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="h-5 w-5" />
                            Copiar Enlace
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      El enlace expira en 15 minutos
                    </div>

                    <button
                      onClick={() => {
                        setDeepLink(null);
                        loadStatus();
                      }}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Ya completé la conexión →
                    </button>
                  </div>
                )}

                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    ❌ {error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* WhatsApp Coming Soon Card */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden opacity-75">
          <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-4 text-white">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <MessageCircle className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  WhatsApp
                  <span className="px-2 py-0.5 bg-white/20 rounded text-xs font-normal">
                    Próximamente
                  </span>
                </h2>
                <p className="text-green-100 text-sm">Pronto podrás conectar WhatsApp Business</p>
              </div>
            </div>
          </div>
          <div className="p-6 text-center text-gray-500">
            <p>La integración con WhatsApp Cloud API estará disponible próximamente.</p>
          </div>
        </div>

        {/* Admin: Connected Sessions */}
        {isOwnerOrAdmin && sessions.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-100 p-4 border-b">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-gray-600" />
                <h2 className="font-semibold text-gray-900">Sesiones Conectadas del Equipo</h2>
              </div>
            </div>
            <div className="divide-y">
              {sessions.map((session) => (
                <div key={session.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <User className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {session.user.name || session.user.email}
                      </p>
                      <p className="text-sm text-gray-500">
                        {session.displayName}
                        {session.username && ` (@${session.username})`}
                        {' • '}
                        <span className="capitalize">{session.platform}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDisconnectSession(session.id)}
                    className="text-sm text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-lg transition-colors"
                  >
                    Desconectar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Security Notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-800 mb-1">Nota de Seguridad</h3>
              <p className="text-sm text-amber-700">
                El bot de Telegram tiene acceso a los mismos datos que tu cuenta de Betsy. 
                Solo conecta desde dispositivos de confianza. Puedes desconectar en cualquier momento.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

