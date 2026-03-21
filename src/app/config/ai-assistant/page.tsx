'use client';

import React, { useState, useEffect } from 'react';
import { 
  Bot, Copy, Check, RefreshCw, Shield, Users, Sparkles, ArrowLeft, Key, MessageCircle, Send
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function AIAssistantPage() {
  const router = useRouter();
  const { data: session } = useSession();
  
  const [botCode, setBotCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'telegram' | 'whatsapp'>('telegram');

  // Load bot access code
  useEffect(() => {
    loadBotCode();
  }, []);

  const loadBotCode = async () => {
    try {
      const res = await fetch('/api/bot/access-code');
      if (res.ok) {
        const data = await res.json();
        setBotCode(data.code);
        setActiveSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Error loading bot code:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCode = async () => {
    setGenerating(true);
    setError(null);
    
    try {
      const res = await fetch('/api/bot/access-code', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setBotCode(data.code);
      } else {
        const error = await res.json();
        setError(error.message || 'Error generando código');
      }
    } catch (err) {
      setError('Error generando código');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!botCode) return;
    
    try {
      await navigator.clipboard.writeText(botCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Error copying:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/config')}
            className="flex items-center text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver a Configuración
          </button>
          
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-4 rounded-2xl shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Betsy AI Assistant</h1>
              <p className="text-muted-foreground mt-1">Gestiona tu negocio desde Telegram y WhatsApp</p>
            </div>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-card rounded-2xl shadow-xl p-8 mb-6 border border-border">
          <div className="flex items-center gap-3 mb-6">
            <Key className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-2xl font-bold text-foreground">Código de Acceso</h2>
          </div>

          {botCode ? (
            <div>
              <p className="text-muted-foreground mb-4">
                Comparte este código con tu equipo para que puedan conectarse al bot desde Telegram o WhatsApp:
              </p>
              
              {/* Code Display */}
              <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground mb-2">Tu código:</p>
                    <p className="text-4xl font-mono font-bold text-blue-600 dark:text-blue-400 tracking-wider select-all">
                      {botCode}
                    </p>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="ml-4 bg-card hover:bg-muted text-blue-600 dark:text-blue-400 p-4 rounded-lg shadow-md transition-all border border-border"
                  >
                    {copied ? <Check className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                  </button>
                </div>
              </div>

              {/* Platform Tabs */}
              <div className="mb-6">
                <div className="flex border-b border-border mb-0">
                  <button
                    onClick={() => setActiveTab('telegram')}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === 'telegram'
                        ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    Telegram
                  </button>
                  <button
                    onClick={() => setActiveTab('whatsapp')}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === 'whatsapp'
                        ? 'border-green-600 text-green-600 dark:text-green-400'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <MessageCircle className="w-4 h-4" />
                    WhatsApp
                  </button>
                </div>

                {/* Telegram Instructions */}
                {activeTab === 'telegram' && (
                  <div className="bg-muted rounded-b-xl p-6">
                    <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
                      <Send className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      Conectarse por Telegram:
                    </h3>
                    <ol className="space-y-3 text-muted-foreground">
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
                        <span>Abre Telegram y busca <code className="bg-card px-2 py-1 rounded text-blue-600 dark:text-blue-400 font-mono border border-border">@betsycrmai_bot</code></span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
                        <span>Envía el mensaje: <code className="bg-card px-2 py-1 rounded text-blue-600 dark:text-blue-400 font-mono border border-border">/start {botCode}</code></span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
                        <span>Cuando el bot pida tu nombre, ingrésalo para completar el registro</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">4</span>
                        <span>¡Listo! Ya puedes crear órdenes, consultar inventario y más</span>
                      </li>
                    </ol>
                  </div>
                )}

                {/* WhatsApp Instructions */}
                {activeTab === 'whatsapp' && (
                  <div className="bg-muted rounded-b-xl p-6">
                    <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
                      <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                      Conectarse por WhatsApp:
                    </h3>
                    <ol className="space-y-3 text-muted-foreground">
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
                        <span>
                          Abre WhatsApp y envía un mensaje a Betsy AI:{' '}
                          <a
                            href={`https://wa.me/50661498470?text=${encodeURIComponent('/start ' + (botCode || ''))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg text-sm font-medium transition-colors"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Abrir WhatsApp
                          </a>
                        </span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
                        <span>Envía el mensaje: <code className="bg-card px-2 py-1 rounded text-green-600 dark:text-green-400 font-mono border border-border">/start {botCode}</code></span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
                        <span>Cuando el bot pida tu nombre, ingrésalo para completar el registro</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">4</span>
                        <span>¡Listo! Ya puedes crear órdenes, consultar inventario y más</span>
                      </li>
                    </ol>
                    <p className="mt-4 text-sm text-muted-foreground">
                      Número de WhatsApp: <span className="font-mono">+506 6149 8470</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Regenerate Button */}
              <div className="flex items-center justify-between pt-6 border-t border-border">
                <div className="text-sm text-muted-foreground">
                  <Shield className="w-4 h-4 inline mr-1" />
                  Regenera el código si crees que fue comprometido
                </div>
                <button
                  onClick={handleGenerateCode}
                  disabled={generating}
                  className="flex items-center gap-2 bg-muted hover:bg-muted/80 text-foreground px-4 py-2 rounded-lg transition-all disabled:opacity-50 border border-border"
                >
                  <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                  Regenerar Código
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Bot className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground mb-6">Aún no tienes un código de acceso para el bot</p>
              <button
                onClick={handleGenerateCode}
                disabled={generating}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-3 rounded-lg shadow-lg transition-all disabled:opacity-50 flex items-center gap-2 mx-auto"
              >
                <Sparkles className="w-5 h-5" />
                {generating ? 'Generando...' : 'Generar Código de Acceso'}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <div className="bg-card rounded-2xl shadow-xl p-8 border border-border">
            <div className="flex items-center gap-3 mb-6">
              <Users className="w-6 h-6 text-green-600 dark:text-green-400" />
              <h2 className="text-2xl font-bold text-foreground">Conexiones Activas</h2>
              <span className="bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-sm font-medium">
                {activeSessions.length}
              </span>
            </div>

            <div className="space-y-3">
              {activeSessions.map((session: any) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-4 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      session.platform === 'whatsapp' ? 'bg-green-100 dark:bg-green-950/30' : 'bg-blue-100 dark:bg-blue-950/30'
                    }`}>
                      {session.platform === 'whatsapp'
                        ? <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                        : <Send className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      }
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {session.providedName || session.displayName || 'Usuario'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {session.username ? `@${session.username}` : (session.platform === 'whatsapp' ? 'WhatsApp' : 'Telegram')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mb-1 ${
                      session.platform === 'whatsapp' ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400' : 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
                    }`}>
                      {session.platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
                    </span>
                    <br />
                    Conectado: {new Date(session.connectedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Cards */}
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-950/50 rounded-xl p-6 border border-blue-200/50 dark:border-blue-900">
            <h3 className="font-bold text-blue-900 dark:text-blue-300 mb-2">✨ Qué puede hacer el bot</h3>
            <ul className="text-blue-800 dark:text-blue-400 text-sm space-y-1">
              <li>• Crear y gestionar órdenes</li>
              <li>• Consultar inventario</li>
              <li>• Ver estadísticas de ventas</li>
              <li>• Generar guías de envío</li>
              <li>• Buscar clientes</li>
            </ul>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-950/50 rounded-xl p-6 border border-purple-200/50 dark:border-purple-900">
            <h3 className="font-bold text-purple-900 dark:text-purple-300 mb-2">🔒 Seguridad</h3>
            <ul className="text-purple-800 dark:text-purple-400 text-sm space-y-1">
              <li>• Código único por empresa</li>
              <li>• Registro de todas las acciones</li>
              <li>• Regeneración cuando sea necesario</li>
              <li>• Control de acceso por código</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

