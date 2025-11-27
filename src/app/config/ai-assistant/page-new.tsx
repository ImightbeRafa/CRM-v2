'use client';

import React, { useState, useEffect } from 'react';
import { 
  Bot, Copy, Check, RefreshCw, Shield, Users, Sparkles, ArrowLeft, Key
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
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/config')}
            className="flex items-center text-gray-600 hover:text-gray-800 mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver a Configuración
          </button>
          
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-4 rounded-2xl shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Betsy AI Assistant</h1>
              <p className="text-gray-600 mt-1">Gestiona tu negocio desde Telegram</p>
            </div>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <Key className="w-6 h-6 text-blue-600" />
            <h2 className="text-2xl font-bold text-gray-800">Código de Acceso</h2>
          </div>

          {botCode ? (
            <div>
              <p className="text-gray-600 mb-4">
                Comparte este código con tu equipo para que puedan conectarse al bot de Telegram:
              </p>
              
              {/* Code Display */}
              <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-sm text-gray-600 mb-2">Tu código:</p>
                    <p className="text-4xl font-mono font-bold text-blue-600 tracking-wider select-all">
                      {botCode}
                    </p>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="ml-4 bg-white hover:bg-gray-50 text-blue-600 p-4 rounded-lg shadow-md transition-all"
                  >
                    {copied ? <Check className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-gray-50 rounded-xl p-6 mb-6">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <Bot className="w-5 h-5" />
                  Cómo conectarse:
                </h3>
                <ol className="space-y-3 text-gray-700">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
                    <span>Abre Telegram y busca <code className="bg-white px-2 py-1 rounded text-blue-600 font-mono">@betsycrmai_bot</code></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
                    <span>Envía el mensaje: <code className="bg-white px-2 py-1 rounded text-blue-600 font-mono">/start {botCode}</code></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">3</span>
                    <span>Cuando el bot pida tu nombre, ingrésalo para completar el registro</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">4</span>
                    <span>¡Listo! Ya puedes crear órdenes, consultar inventario y más desde Telegram</span>
                  </li>
                </ol>
              </div>

              {/* Regenerate Button */}
              <div className="flex items-center justify-between pt-6 border-t">
                <div className="text-sm text-gray-600">
                  <Shield className="w-4 h-4 inline mr-1" />
                  Regenera el código si crees que fue comprometido
                </div>
                <button
                  onClick={handleGenerateCode}
                  disabled={generating}
                  className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                  Regenerar Código
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Bot className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 mb-6">Aún no tienes un código de acceso para el bot</p>
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
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <Users className="w-6 h-6 text-green-600" />
              <h2 className="text-2xl font-bold text-gray-800">Conexiones Activas</h2>
              <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium">
                {activeSessions.length}
              </span>
            </div>

            <div className="space-y-3">
              {activeSessions.map((session: any) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Bot className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">
                        {session.providedName || session.displayName || 'Usuario'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {session.username ? `@${session.username}` : session.platform}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    Conectado: {new Date(session.connectedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Cards */}
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6">
            <h3 className="font-bold text-blue-900 mb-2">✨ Qué puede hacer el bot</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• Crear y gestionar órdenes</li>
              <li>• Consultar inventario</li>
              <li>• Ver estadísticas de ventas</li>
              <li>• Generar guías de envío</li>
              <li>• Buscar clientes</li>
            </ul>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6">
            <h3 className="font-bold text-purple-900 mb-2">🔒 Seguridad</h3>
            <ul className="text-purple-800 text-sm space-y-1">
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

