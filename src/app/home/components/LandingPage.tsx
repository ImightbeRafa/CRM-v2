'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { 
  ArrowRight,
  Menu,
  X,
  Mic,
  Send,
  Package,
  BarChart3,
  Users,
  Zap,
  CheckCircle,
  MessageCircle,
  Bot,
  Phone,
  Mail,
  Instagram,
  ChevronDown,
  TrendingUp,
  Clock,
  Bell,
  Star,
  Eye
} from 'lucide-react';
import SimplePricingSection from './SimplePricingSection';
import SimpleAuthModal from './SimpleAuthModal';

// Platform icons
const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
  </svg>
);

// Messaging app demo component with platform toggle
const MessagingDemo = ({ platform }: { platform: 'telegram' | 'whatsapp' }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  
  const messages = [
    { type: 'user', content: '🎤', isVoice: true, voiceText: '"Cuántas órdenes tengo pendientes?"' },
    { type: 'bot', content: '📊 Tienes **8 órdenes pendientes** hoy:\n\n• 3 nuevas por procesar\n• 5 listas para envío\n\n¿Quieres ver los detalles?' },
    { type: 'user', content: 'Crea orden para María García, 2 camisetas, ₡25,000' },
    { type: 'bot', content: '✅ **Orden #1847 creada**\n\n👤 María García\n📦 2x Camiseta\n💰 ₡25,000\n\n¿Agrego dirección?' },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      if (currentStep < messages.length - 1) {
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setCurrentStep(prev => prev + 1);
        }, 1000);
      } else {
        setTimeout(() => {
          setCurrentStep(0);
        }, 3000);
      }
    }, 3500);
    
    return () => clearInterval(interval);
  }, [currentStep, messages.length]);

  const isTelegram = platform === 'telegram';
  const bgPrimary = isTelegram ? 'bg-[#0e1621]' : 'bg-[#efeae2]';
  const bgHeader = isTelegram ? 'bg-[#17212b]' : 'bg-[#075e54]';
  const bgUserBubble = isTelegram ? 'bg-[#2b5278]' : 'bg-[#dcf8c6]';
  const bgBotBubble = isTelegram ? 'bg-[#182533]' : 'bg-white';
  const textUser = isTelegram ? 'text-white' : 'text-gray-900';
  const textBot = isTelegram ? 'text-gray-100' : 'text-gray-900';
  const bgInput = isTelegram ? 'bg-[#242f3d]' : 'bg-white';

  return (
    <div className="relative">
      {/* Phone Frame */}
      <div className="relative mx-auto w-[300px] md:w-[340px]">
        {/* Glow effect */}
        <div className={`absolute -inset-4 blur-3xl rounded-full ${
          isTelegram 
            ? 'bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20' 
            : 'bg-gradient-to-r from-green-500/20 via-emerald-500/20 to-teal-500/20'
        }`} />
        
        {/* Phone */}
        <div className="relative bg-gray-900 rounded-[2.5rem] p-2.5 shadow-2xl">
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-gray-900 rounded-b-xl z-10" />
          
          {/* Screen */}
          <div className={`${bgPrimary} rounded-[2rem] overflow-hidden`}>
            {/* Header */}
            <div className={`${bgHeader} px-4 py-2.5 flex items-center gap-3 border-b ${isTelegram ? 'border-gray-700/50' : 'border-transparent'}`}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                isTelegram 
                  ? 'bg-gradient-to-br from-blue-500 to-purple-600' 
                  : 'bg-gradient-to-br from-green-500 to-emerald-600'
              }`}>
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-white font-medium text-sm">Betsy AI</p>
                <p className={`text-xs ${isTelegram ? 'text-green-400' : 'text-green-300'}`}>online</p>
              </div>
            </div>
            
            {/* Chat Messages */}
            <div className={`h-[340px] md:h-[380px] p-3 space-y-3 overflow-hidden ${!isTelegram ? 'bg-[url("/whatsapp-bg.png")] bg-repeat bg-[length:400px]' : ''}`}>
              {messages.slice(0, currentStep + 1).map((msg, i) => (
                <div 
                  key={i}
                  className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}
                >
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
                    msg.type === 'user' 
                      ? `${bgUserBubble} ${textUser} rounded-br-sm` 
                      : `${bgBotBubble} ${textBot} rounded-bl-sm`
                  }`}>
                    {msg.isVoice ? (
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          isTelegram ? 'bg-purple-500/30' : 'bg-green-500/30'
                        }`}>
                          <Mic className={`w-4 h-4 ${isTelegram ? 'text-purple-400' : 'text-green-600'}`} />
                        </div>
                        <div>
                          <div className="flex gap-0.5 mb-1">
                            {[...Array(10)].map((_, i) => (
                              <div 
                                key={i} 
                                className={`w-0.5 rounded-full ${isTelegram ? 'bg-purple-400' : 'bg-green-500'}`}
                                style={{ height: `${Math.random() * 12 + 6}px` }}
                              />
                            ))}
                          </div>
                          <p className={`text-xs italic ${isTelegram ? 'text-gray-400' : 'text-gray-500'}`}>{msg.voiceText}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs whitespace-pre-line">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div className="flex justify-start animate-in fade-in">
                  <div className={`${bgBotBubble} rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm`}>
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Input Bar */}
            <div className={`${isTelegram ? 'bg-[#17212b]' : 'bg-[#f0f0f0]'} px-3 py-2.5 flex items-center gap-2 border-t ${isTelegram ? 'border-gray-700/50' : 'border-gray-200'}`}>
              <button className={`p-1.5 ${isTelegram ? 'text-gray-400' : 'text-gray-500'}`}>
                <Mic className="w-4 h-4" />
              </button>
              <div className={`flex-1 ${bgInput} rounded-full px-3 py-1.5 ${!isTelegram ? 'shadow-sm' : ''}`}>
                <p className={`text-xs ${isTelegram ? 'text-gray-500' : 'text-gray-400'}`}>Escribe o envía audio...</p>
              </div>
              <button className={`p-1.5 ${isTelegram ? 'text-blue-400' : 'text-green-600'}`}>
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// AI Assistant Section with platform toggle
const AIAssistantSection = ({ 
  aiCapabilities, 
  onOpenAuth 
}: { 
  aiCapabilities: string[]; 
  onOpenAuth: () => void;
}) => {
  const [selectedPlatform, setSelectedPlatform] = useState<'telegram' | 'whatsapp'>('telegram');

  return (
    <section id="ai-assistant" className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-slate-50 to-purple-50">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left - Content */}
          <div>
            <Badge className="mb-6 bg-purple-100 text-purple-700 border-purple-200">
              <Bot className="w-3 h-3 mr-1" />
              AI Sales Assistant
            </Badge>
            
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
              Tu negocio en
              <span className="block bg-gradient-to-r from-[#0088cc] to-[#25D366] bg-clip-text text-transparent">
                Telegram & WhatsApp
              </span>
            </h2>
            
            <p className="text-gray-600 text-lg mb-6">
              Envía un mensaje de voz o texto y el asistente entiende lo que necesitas. 
              Crea órdenes, consulta inventario, ve estadísticas - todo hablando naturalmente en español.
              <span className="font-medium text-gray-700"> Usa la app que prefieras.</span>
            </p>
            
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100 mb-6">
              <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Mic className="w-5 h-5 text-purple-600" />
                Lo que puedes hacer:
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {aiCapabilities.map((cap, i) => (
                  <div key={i} className="flex items-center gap-2 text-gray-600 text-sm">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    {cap}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                size="lg"
                className="bg-gradient-to-r from-[#0088cc] to-[#0077b5] hover:from-[#0077b5] hover:to-[#006699] text-white"
                onClick={onOpenAuth}
              >
                <span className="mr-2"><TelegramIcon /></span>
                Conectar Telegram
              </Button>
              <Button 
                size="lg"
                className="bg-gradient-to-r from-[#25D366] to-[#128C7E] hover:from-[#128C7E] hover:to-[#075e54] text-white"
                onClick={onOpenAuth}
              >
                <span className="mr-2"><WhatsAppIcon /></span>
                Conectar WhatsApp
              </Button>
            </div>
          </div>
          
          {/* Right - Phone Demo with Toggle */}
          <div className="flex flex-col items-center">
            {/* Platform Toggle */}
            <div className="flex bg-gray-100 rounded-full p-1 mb-6 shadow-inner">
              <button
                onClick={() => setSelectedPlatform('telegram')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  selectedPlatform === 'telegram'
                    ? 'bg-white text-[#0088cc] shadow-md'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <TelegramIcon />
                Telegram
              </button>
              <button
                onClick={() => setSelectedPlatform('whatsapp')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  selectedPlatform === 'whatsapp'
                    ? 'bg-white text-[#25D366] shadow-md'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <WhatsAppIcon />
                WhatsApp
              </button>
            </div>
            
            <MessagingDemo platform={selectedPlatform} />
          </div>
        </div>
      </div>
    </section>
  );
};

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const platformFeatures = [
    {
      icon: <TrendingUp className="h-6 w-6" />,
      title: "Incrementa tus Ventas",
      description: "Rastrea cada oportunidad desde el primer contacto hasta la venta cerrada."
    },
    {
      icon: <Package className="h-6 w-6" />,
      title: "Gestiona Pedidos",
      description: "Todos tus pedidos organizados en un solo lugar con seguimiento visual."
    },
    {
      icon: <Clock className="h-6 w-6" />,
      title: "Ahorra Tiempo",
      description: "Automatiza tareas repetitivas y enfócate en hacer crecer tu negocio."
    },
    {
      icon: <BarChart3 className="h-6 w-6" />,
      title: "Conoce tus Números",
      description: "Reportes claros y fáciles de entender sobre tu rendimiento."
    },
    {
      icon: <Users className="h-6 w-6" />,
      title: "Equipo Alineado",
      description: "Todos ven la misma información. Sin confusiones ni duplicados."
    },
    {
      icon: <Bell className="h-6 w-6" />,
      title: "Nunca Olvides",
      description: "Recordatorios automáticos para seguimientos importantes."
    }
  ];

  const aiCapabilities = [
    "Crear órdenes con voz o texto",
    "Consultar inventario en tiempo real",
    "Ver estadísticas de ventas",
    "Buscar clientes y su historial",
    "Actualizar estados de pedidos",
    "Generar guías de envío",
    "Reportes de productos más vendidos",
    "Alertas de stock bajo"
  ];

  const testimonials = [
    {
      name: "María González",
      role: "Boutique Luna",
      content: "Desde que uso Betsy, mis ventas aumentaron 40%. Puedo ver todos mis pedidos en un solo lugar.",
      rating: 5
    },
    {
      name: "Carlos Ramírez",
      role: "Distribuidora CR",
      content: "Antes perdíamos pedidos en WhatsApp. Ahora todo está organizado y mi equipo sabe qué hacer.",
      rating: 5
    },
    {
      name: "Ana Jiménez",
      role: "E-commerce Manager",
      content: "El tablero visual cambió todo. Arrastrar pedidos entre etapas es súper simple pero poderoso.",
      rating: 5
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Navigation */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/90 backdrop-blur-xl shadow-sm border-b border-gray-100' : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 md:h-20">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Betsy
              </span>
            </div>
            
            <div className="hidden md:flex items-center gap-8">
              <a href="#platform" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">Plataforma</a>
              <a href="#ai-assistant" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">AI Assistant</a>
              <a href="#pricing" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">Precios</a>
              <a href="#contact" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">Contacto</a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <Button 
                variant="ghost" 
                className="text-gray-600 hover:text-blue-600"
                onClick={() => setIsAuthModalOpen(true)}
              >
                Iniciar Sesión
              </Button>
              <Button 
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
                onClick={() => setIsAuthModalOpen(true)}
              >
                Empezar Gratis
              </Button>
            </div>

            <button 
              className="md:hidden p-2 text-gray-600"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 shadow-lg">
            <div className="px-4 py-4 space-y-3">
              <a href="#platform" className="block text-gray-600 hover:text-blue-600 py-2 font-medium">Plataforma</a>
              <a href="#ai-assistant" className="block text-gray-600 hover:text-blue-600 py-2 font-medium">AI Assistant</a>
              <a href="#pricing" className="block text-gray-600 hover:text-blue-600 py-2 font-medium">Precios</a>
              <a href="#contact" className="block text-gray-600 hover:text-blue-600 py-2 font-medium">Contacto</a>
              <div className="pt-4 flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setIsAuthModalOpen(true)}>
                  Iniciar Sesión
                </Button>
                <Button className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600" onClick={() => setIsAuthModalOpen(true)}>
                  Empezar
                </Button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-28 md:pt-36 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <Badge className="mb-6 bg-gradient-to-r from-blue-100 to-purple-100 text-blue-700 border-blue-200">
              <Zap className="w-3 h-3 mr-1" />
              NUEVO: Asistente con mensajes de voz
            </Badge>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
              Vende más. Organízate mejor.
              <span className="block bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Crece más rápido.
              </span>
            </h1>
            
            <p className="text-lg md:text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
              La plataforma de gestión de pedidos más simple para tu negocio. 
              Ahora con <span className="font-semibold text-purple-600">AI Assistant</span> en 
              <span className="inline-flex items-center gap-1 mx-1">
                <span className="text-[#0088cc]">Telegram</span> y <span className="text-[#25D366]">WhatsApp</span>
              </span>
              para gestionar todo con voz o texto.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
              <Button 
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-lg px-8 h-14 rounded-xl"
                onClick={() => setIsAuthModalOpen(true)}
              >
                Empezar Gratis
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button 
                size="lg"
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-50 text-lg px-8 h-14 rounded-xl"
                onClick={() => document.getElementById('platform')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Ver Cómo Funciona
                <Eye className="ml-2 w-5 h-5" />
              </Button>
            </div>
            
            <p className="text-sm text-gray-500">
              Sin tarjeta de crédito • 7 días gratis • Cancela cuando quieras
            </p>
          </div>
          
          {/* Scroll Indicator */}
          <div className="flex justify-center mt-8">
            <a href="#platform" className="animate-bounce text-gray-400 hover:text-blue-600 transition-colors">
              <ChevronDown className="w-8 h-8" />
            </a>
          </div>
        </div>
      </section>

      {/* Two Pillars Section */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-600 to-purple-700">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Dos formas de potenciar tu negocio
            </h2>
            <p className="text-blue-100 text-lg max-w-2xl mx-auto">
              Usa la plataforma web completa o gestiona todo desde Telegram y WhatsApp con IA
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8">
            {/* Platform Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 hover:bg-white/15 transition-all">
              <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center mb-6">
                <BarChart3 className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Plataforma Web</h3>
              <p className="text-blue-100 mb-6">
                Dashboard completo para gestionar pedidos, clientes, inventario y reportes desde cualquier navegador.
              </p>
              <ul className="space-y-2 text-blue-100">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Tablero Kanban visual
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Reportes y estadísticas
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Gestión de inventario
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Multi-usuario con roles
                </li>
              </ul>
            </div>
            
            {/* AI Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 hover:bg-white/15 transition-all">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-14 h-14 bg-gradient-to-br from-[#0088cc] to-[#0077b5] rounded-xl flex items-center justify-center text-white">
                  <TelegramIcon />
                </div>
                <div className="w-14 h-14 bg-gradient-to-br from-[#25D366] to-[#128C7E] rounded-xl flex items-center justify-center text-white">
                  <WhatsAppIcon />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">AI en Telegram & WhatsApp</h3>
              <p className="text-blue-100 mb-6">
                Asistente inteligente que entiende voz y texto. Gestiona tu negocio conversando naturalmente desde tu app favorita.
              </p>
              <ul className="space-y-2 text-blue-100">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Mensajes de voz con Whisper AI
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Crea órdenes hablando
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Consultas en español natural
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Respuestas instantáneas
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Section */}
      <section id="platform" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-blue-100 text-blue-700 border-blue-200">
              Plataforma Web
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Todo lo que necesitas para crecer
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Herramientas simples y poderosas para vender más y mantenerte organizado
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {platformFeatures.map((feature, index) => (
              <Card key={index} className="border-0 shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 bg-gradient-to-br from-white to-gray-50">
                <CardContent className="pt-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="p-3 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl text-blue-600">
                      {feature.icon}
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">{feature.title}</h3>
                  </div>
                  <p className="text-gray-600">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Dashboard Preview */}
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 md:p-8 shadow-2xl">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="ml-4 text-gray-400 text-sm">dashboard.betsycrm.com</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm">Ventas del Mes</span>
                  <TrendingUp className="w-4 h-4 text-green-400" />
                </div>
                <p className="text-2xl font-bold text-white">₡2,450,000</p>
                <p className="text-green-400 text-sm">↑ 23% vs mes anterior</p>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm">Órdenes</span>
                  <Package className="w-4 h-4 text-blue-400" />
                </div>
                <p className="text-2xl font-bold text-white">187</p>
                <p className="text-blue-400 text-sm">34 pendientes</p>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm">Clientes</span>
                  <Users className="w-4 h-4 text-purple-400" />
                </div>
                <p className="text-2xl font-bold text-white">423</p>
                <p className="text-purple-400 text-sm">+18 esta semana</p>
              </div>
            </div>
            
            {/* Mini Kanban */}
            <div className="bg-white/5 rounded-xl p-4">
              <h4 className="text-white font-medium mb-4">Tablero de Pedidos</h4>
              <div className="grid grid-cols-4 gap-3">
                {['Nuevo', 'En Proceso', 'Enviado', 'Entregado'].map((status, i) => (
                  <div key={i} className="space-y-2">
                    <div className={`text-xs font-medium px-2 py-1 rounded-full text-center ${
                      i === 0 ? 'bg-yellow-500/20 text-yellow-300' :
                      i === 1 ? 'bg-blue-500/20 text-blue-300' :
                      i === 2 ? 'bg-purple-500/20 text-purple-300' :
                      'bg-green-500/20 text-green-300'
                    }`}>
                      {status}
                    </div>
                    <div className="bg-white/10 rounded-lg p-2">
                      <p className="text-white text-xs font-medium">#{1240 + i}</p>
                      <p className="text-gray-400 text-xs">Cliente {i + 1}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AI Assistant Section */}
      <AIAssistantSection 
        aiCapabilities={aiCapabilities} 
        onOpenAuth={() => setIsAuthModalOpen(true)} 
      />

      {/* Testimonials */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Lo que dicen nuestros clientes
            </h2>
            <p className="text-xl text-gray-600">
              Negocios reales con resultados reales
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-0 shadow-lg hover:shadow-xl transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-center mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                    ))}
                  </div>
                  <p className="text-gray-700 mb-4">&ldquo;{testimonial.content}&rdquo;</p>
                  <div>
                    <p className="font-semibold text-gray-900">{testimonial.name}</p>
                    <p className="text-sm text-gray-600">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-blue-600 to-purple-600">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: '10k+', label: 'Órdenes procesadas' },
              { value: '500+', label: 'Negocios activos' },
              { value: '99.9%', label: 'Uptime garantizado' },
              { value: '<2s', label: 'Tiempo de respuesta' },
            ].map((stat, i) => (
              <div key={i}>
                <div className="text-4xl md:text-5xl font-bold text-white mb-2">{stat.value}</div>
                <div className="text-blue-100 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <SimplePricingSection />
      </section>

      {/* Contact */}
      <section id="contact" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            ¿Preguntas?
          </h2>
          <p className="text-gray-600 text-lg mb-12">
            Estamos aquí para ayudarte
          </p>
          
          <div className="grid md:grid-cols-3 gap-6">
            <a 
              href="https://wa.me/50661498470"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-white border-2 border-gray-100 rounded-2xl p-6 hover:border-green-300 hover:shadow-lg transition-all"
            >
              <div className="w-14 h-14 mx-auto bg-green-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Phone className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">WhatsApp</h3>
              <p className="text-gray-500 text-sm">+506 6149-8470</p>
            </a>
            
            <a 
              href="mailto:betsycrm.cr@gmail.com"
              className="group bg-white border-2 border-gray-100 rounded-2xl p-6 hover:border-blue-300 hover:shadow-lg transition-all"
            >
              <div className="w-14 h-14 mx-auto bg-blue-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Mail className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Email</h3>
              <p className="text-gray-500 text-sm">betsycrm.cr@gmail.com</p>
            </a>
            
            <a 
              href="https://www.instagram.com/betsy_crm/"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-white border-2 border-gray-100 rounded-2xl p-6 hover:border-pink-300 hover:shadow-lg transition-all"
            >
              <div className="w-14 h-14 mx-auto bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Instagram className="w-6 h-6 text-pink-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Instagram</h3>
              <p className="text-gray-500 text-sm">@betsy_crm</p>
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-600 to-purple-700">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Empieza a vender más hoy
          </h2>
          <p className="text-blue-100 text-lg mb-8 max-w-xl mx-auto">
            Únete a cientos de negocios que ya usan Betsy para crecer
          </p>
          <Button 
            size="lg"
            className="bg-white text-blue-600 hover:bg-gray-100 text-lg px-8 h-14 rounded-xl font-semibold"
            onClick={() => setIsAuthModalOpen(true)}
          >
            Crear Cuenta Gratis
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Main Footer */}
          <div className="py-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
            {/* Brand */}
            <div className="lg:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Betsy</span>
              </div>
              <p className="text-gray-400 text-sm mb-6">
                La plataforma de gestión de pedidos más simple para tu negocio. Con AI Assistant en Telegram y WhatsApp.
              </p>
              <div className="flex gap-3">
                <a 
                  href="https://t.me/BetsyCRMBot" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 hover:bg-[#0088cc] rounded-lg flex items-center justify-center transition-colors"
                  title="Telegram"
                >
                  <TelegramIcon />
                </a>
                <a 
                  href="https://wa.me/50661498470" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 hover:bg-[#25D366] rounded-lg flex items-center justify-center transition-colors"
                  title="WhatsApp"
                >
                  <WhatsAppIcon />
                </a>
                <a 
                  href="https://www.instagram.com/betsy_crm/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 hover:bg-gradient-to-br hover:from-purple-600 hover:to-pink-600 rounded-lg flex items-center justify-center transition-all"
                  title="Instagram"
                >
                  <Instagram className="w-5 h-5" />
                </a>
                <a 
                  href="mailto:betsycrm.cr@gmail.com"
                  className="w-10 h-10 bg-gray-800 hover:bg-blue-600 rounded-lg flex items-center justify-center transition-colors"
                  title="Email"
                >
                  <Mail className="w-5 h-5" />
                </a>
              </div>
            </div>
            
            {/* Product */}
            <div>
              <h4 className="font-semibold mb-4 text-white">Producto</h4>
              <ul className="space-y-3 text-gray-400">
                <li><a href="#platform" className="hover:text-white transition-colors">Plataforma Web</a></li>
                <li><a href="#ai-assistant" className="hover:text-white transition-colors">AI Assistant</a></li>
                <li className="flex items-center gap-2">
                  <span className="text-[#0088cc]"><TelegramIcon /></span>
                  Telegram Bot
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#25D366]"><WhatsAppIcon /></span>
                  WhatsApp Bot
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">Nuevo</Badge>
                </li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Precios</a></li>
              </ul>
            </div>
            
            {/* Resources */}
            <div>
              <h4 className="font-semibold mb-4 text-white">Recursos</h4>
              <ul className="space-y-3 text-gray-400">
                <li><a href="#contact" className="hover:text-white transition-colors">Contacto</a></li>
                <li><a href="https://wa.me/50661498470" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Soporte WhatsApp</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Tutoriales</a></li>
                <li><a href="#" className="hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>
            
            {/* Legal */}
            <div>
              <h4 className="font-semibold mb-4 text-white">Legal</h4>
              <ul className="space-y-3 text-gray-400">
                <li><a href="/terms" className="hover:text-white transition-colors">Términos de Servicio</a></li>
                <li><a href="/privacy" className="hover:text-white transition-colors">Política de Privacidad</a></li>
                <li><a href="/privacy#security" className="hover:text-white transition-colors">Seguridad</a></li>
              </ul>
            </div>
          </div>
          
          {/* Bottom Bar */}
          <div className="border-t border-gray-800 py-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <p className="text-gray-500 text-sm">
                © 2025 Betsy. Todos los derechos reservados.
              </p>
              <p className="text-gray-500 text-sm flex items-center gap-1">
                Hecho con <span className="text-red-500">❤️</span> en Costa Rica 🇨🇷
              </p>
            </div>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <SimpleAuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
      />
    </div>
  );
}
