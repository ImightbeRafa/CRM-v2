'use client';

import { useState, useEffect } from 'react';
import { motion, type Variants } from 'framer-motion';
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
  CheckCircle,
  Bot,
  Phone,
  Mail,
  Instagram,
  ChevronDown,
  TrendingUp,
  Clock,
  Bell,
  Star,
  Eye,
  Truck
} from 'lucide-react';
import SimplePricingSection from './SimplePricingSection';
import SimpleAuthModal from './SimpleAuthModal';

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const heroStagger: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const heroItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

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
    <section id="ai-assistant" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#0c0b14] to-[#0a0a0f] relative overflow-hidden">
      <div className="absolute top-1/3 right-0 w-[500px] h-[500px] rounded-full bg-purple-600/8 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full bg-blue-600/8 blur-[100px] pointer-events-none" />
      <div className="max-w-7xl mx-auto relative z-10">
        <motion.div
          className="grid lg:grid-cols-2 gap-12 items-center"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
        >
          {/* Left - Content */}
          <div>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium tracking-wide uppercase bg-purple-500/10 text-purple-400 border border-purple-500/20 mb-6">
              <Bot className="w-3 h-3" />
              AI Sales Assistant
            </span>
            
            <h2 className="landing-h2 text-white mb-6">
              Tu negocio en
              <span className="block bg-gradient-to-r from-[#0088cc] to-[#25D366] bg-clip-text text-transparent">
                Telegram & WhatsApp
              </span>
            </h2>
            
            <p className="text-gray-400 text-lg mb-6">
              Envía un mensaje de voz o texto y el asistente entiende lo que necesitas. 
              Crea órdenes, consulta inventario, ve estadísticas - todo hablando naturalmente en español.
              <span className="font-medium text-white"> Usa la app que prefieras.</span>
            </p>
            
            <div className="bg-white/5 rounded-xl p-6 border border-white/10 mb-6">
              <h4 className="font-semibold text-white mb-4 flex items-center gap-2">
                <Mic className="w-5 h-5 text-purple-400" />
                Lo que puedes hacer:
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {aiCapabilities.map((cap, i) => (
                  <div key={i} className="flex items-center gap-2 text-gray-400 text-sm">
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
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
            <div className="flex bg-white/10 rounded-full p-1 mb-6">
              <button
                onClick={() => setSelectedPlatform('telegram')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  selectedPlatform === 'telegram'
                    ? 'bg-white/15 text-[#0088cc] shadow-md'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <TelegramIcon />
                Telegram
              </button>
              <button
                onClick={() => setSelectedPlatform('whatsapp')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  selectedPlatform === 'whatsapp'
                    ? 'bg-white/15 text-[#25D366] shadow-md'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <WhatsAppIcon />
                WhatsApp
              </button>
            </div>
            
            <MessagingDemo platform={selectedPlatform} />
          </div>
        </motion.div>
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
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-500 ${
        scrolled ? 'bg-gray-950/80 backdrop-blur-2xl shadow-[0_1px_3px_rgba(0,0,0,0.2),0_8px_24px_rgba(0,0,0,0.15)] border-b border-white/10' : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 md:h-20">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent leading-relaxed pb-0.5">
                Betsy
              </span>
            </div>
            
            <div className="hidden md:flex items-center gap-8">
              <a href="#platform" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">Plataforma</a>
              <a href="#ai-assistant" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">AI Assistant</a>
              <a href="#correos" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">Envíos</a>
              <a href="#pricing" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">Precios</a>
              <a href="#contact" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">Contacto</a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <Button 
                variant="ghost" 
                className="text-gray-300 hover:text-white hover:bg-white/10"
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
              className="md:hidden p-2 text-gray-300"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-gray-950/95 backdrop-blur-2xl border-t border-white/10">
            <div className="px-4 py-4 space-y-3">
              <a href="#platform" onClick={() => setIsMenuOpen(false)} className="block text-gray-300 hover:text-white py-2 font-medium">Plataforma</a>
              <a href="#ai-assistant" onClick={() => setIsMenuOpen(false)} className="block text-gray-300 hover:text-white py-2 font-medium">AI Assistant</a>
              <a href="#correos" onClick={() => setIsMenuOpen(false)} className="block text-gray-300 hover:text-white py-2 font-medium">Envíos</a>
              <a href="#pricing" onClick={() => setIsMenuOpen(false)} className="block text-gray-300 hover:text-white py-2 font-medium">Precios</a>
              <a href="#contact" onClick={() => setIsMenuOpen(false)} className="block text-gray-300 hover:text-white py-2 font-medium">Contacto</a>
              <div className="pt-4 flex gap-3">
                <Button variant="outline" className="flex-1 border-white/20 text-gray-300 hover:bg-white/10 hover:text-white" onClick={() => { setIsMenuOpen(false); setIsAuthModalOpen(true); }}>
                  Iniciar Sesión
                </Button>
                <Button className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600" onClick={() => { setIsMenuOpen(false); setIsAuthModalOpen(true); }}>
                  Empezar
                </Button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-32 md:pt-44 pb-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden grain">
        {/* Roaming gradient wave */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {/* Primary wave -- blue to purple, roams across the section */}
          <div
            className="absolute rounded-full"
            style={{
              width: '130vw',
              height: '60vh',
              top: '20%',
              left: '-15%',
              background: 'linear-gradient(135deg, hsl(217 91% 60% / 0.35), hsl(263 70% 55% / 0.3), hsl(330 81% 60% / 0.2), transparent)',
              filter: 'blur(60px)',
              animation: 'hero-wave-roam 25s ease-in-out infinite',
              willChange: 'transform',
            }}
          />
          {/* Counter-wave -- pink to purple, moves opposite direction */}
          <div
            className="absolute rounded-full"
            style={{
              width: '100vw',
              height: '45vh',
              top: '10%',
              left: '10%',
              background: 'linear-gradient(225deg, hsl(330 81% 65% / 0.25), hsl(280 60% 55% / 0.2), hsl(217 91% 60% / 0.15), transparent)',
              filter: 'blur(70px)',
              animation: 'hero-wave-counter 30s ease-in-out infinite',
              willChange: 'transform',
            }}
          />
        </div>

        <div className="max-w-7xl mx-auto relative z-10">
          <motion.div
            className="text-center mb-12"
            variants={heroStagger}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={heroItem}>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium tracking-wide uppercase bg-gradient-to-r from-blue-50 to-purple-50 text-blue-700 border border-blue-200/60 mb-8">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
                </span>
                NUEVO: Asistente con mensajes de voz
              </span>
            </motion.div>
            
            <motion.h1 variants={heroItem} className="landing-hero text-foreground mb-8 max-w-3xl mx-auto">
              Vende más. Organízate mejor.
              <span className="block bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Crece más rápido.
              </span>
            </motion.h1>
            
            <motion.p variants={heroItem} className="text-lg md:text-xl text-text-secondary mb-10 max-w-2xl mx-auto">
              La plataforma de gestión de pedidos más simple para tu negocio. 
              Ahora con <span className="font-semibold text-purple-600">AI Assistant</span> en 
              <span className="inline-flex items-center gap-1 mx-1">
                <span className="text-[#0088cc]">Telegram</span> y <span className="text-[#25D366]">WhatsApp</span>
              </span>
              para gestionar todo con voz o texto.
            </motion.p>
            
            <motion.div variants={heroItem} className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Button 
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-lg px-10 h-14 rounded-2xl shadow-[0_0_40px_rgba(124,58,237,0.2)] hover:shadow-[0_0_50px_rgba(124,58,237,0.35)] hover:-translate-y-0.5 transition-all duration-300"
                onClick={() => setIsAuthModalOpen(true)}
              >
                Empezar Gratis
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button 
                size="lg"
                variant="outline"
                className="border-gray-300 text-foreground hover:bg-gray-50 text-lg px-8 h-14 rounded-2xl hover:-translate-y-0.5 transition-all duration-300"
                onClick={() => document.getElementById('platform')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Ver Cómo Funciona
                <Eye className="ml-2 w-5 h-5" />
              </Button>
            </motion.div>
            
            <motion.p variants={heroItem} className="text-sm text-text-secondary">
              Sin tarjeta de crédito • 7 días gratis • Cancela cuando quieras
            </motion.p>
          </motion.div>
          
          {/* Scroll Indicator */}
          <motion.div
            className="flex justify-center mt-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
          >
            <a href="#platform" className="animate-bounce text-gray-400 hover:text-blue-600 transition-colors">
              <ChevronDown className="w-8 h-8" />
            </a>
          </motion.div>
        </div>
      </section>

      <div className="section-divider" />

      {/* Two Pillars Section */}
      <section className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-[#0f0b1a] via-[#131025] to-[#0d0f1a] relative overflow-hidden">
        <div className="absolute -top-32 left-1/4 w-[500px] h-[500px] rounded-full bg-purple-600/10 blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-32 right-1/4 w-[400px] h-[400px] rounded-full bg-blue-600/10 blur-[100px] pointer-events-none" />
        <div className="max-w-7xl mx-auto relative z-10">
          <motion.div
            className="text-center mb-12"
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
          >
            <h2 className="landing-h2 text-white mb-4">
              Todo para potenciar tu negocio
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Plataforma web, asistente IA en tus apps favoritas y envíos integrados
            </p>
          </motion.div>
          
          <motion.div
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
          >
            {/* Platform Card */}
            <motion.div variants={fadeUp} className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10 hover:bg-white/[0.08] transition-all duration-300">
              <div className="w-14 h-14 bg-white/10 rounded-xl flex items-center justify-center mb-6">
                <BarChart3 className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Plataforma Web</h3>
              <p className="text-gray-400 mb-6">
                Dashboard completo para gestionar pedidos, clientes, inventario y reportes desde cualquier navegador.
              </p>
              <ul className="space-y-2 text-gray-300">
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
            </motion.div>
            
            {/* AI Card */}
            <motion.div variants={fadeUp} className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10 hover:bg-white/[0.08] transition-all duration-300">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-14 h-14 bg-gradient-to-br from-[#0088cc] to-[#0077b5] rounded-xl flex items-center justify-center text-white">
                  <TelegramIcon />
                </div>
                <div className="w-14 h-14 bg-gradient-to-br from-[#25D366] to-[#128C7E] rounded-xl flex items-center justify-center text-white">
                  <WhatsAppIcon />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">AI en Telegram & WhatsApp</h3>
              <p className="text-gray-400 mb-6">
                Asistente inteligente que entiende voz y texto. Gestiona tu negocio conversando naturalmente desde tu app favorita.
              </p>
              <ul className="space-y-2 text-gray-300">
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
            </motion.div>

            {/* Correos de Costa Rica Card */}
            <motion.div id="correos" variants={fadeUp} className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10 hover:bg-white/[0.08] transition-all duration-300">
              <div className="w-14 h-14 bg-emerald-500/15 rounded-xl flex items-center justify-center mb-6">
                <Truck className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">Envíos con Correos CR</h3>
              <p className="text-gray-400 mb-6">
                Genera guías de Correos de Costa Rica directamente desde Betsy. Un clic para envíos masivos en lote.
              </p>
              <ul className="space-y-2 text-gray-300">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Generación masiva en lote
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Automatización completa
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Desde web o Telegram
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  Integración oficial
                </li>
              </ul>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Platform Section */}
      <section id="platform" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-background">
        <div className="max-w-7xl mx-auto">
          <motion.div
            className="text-center mb-16"
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
          >
            <Badge className="mb-4 bg-blue-100 text-blue-700 border-blue-200">
              Plataforma Web
            </Badge>
            <h2 className="landing-h2 text-foreground mb-4">
              Todo lo que necesitas para crecer
            </h2>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto">
              Herramientas simples y poderosas para vender más y mantenerte organizado
            </p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.15 }}
          >
            {platformFeatures.map((feature, index) => (
              <motion.div key={index} variants={fadeUp}>
                <Card className="border border-gray-100/80 shadow-elevated hover:shadow-elevated-hover transition-all duration-300 hover:-translate-y-1.5 bg-background h-full overflow-hidden relative">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-purple-500" />
                  <CardContent className="pt-7">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="p-4 bg-surface-elevated rounded-xl text-blue-600 ring-1 ring-gray-100">
                        {feature.icon}
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                    </div>
                    <p className="text-text-secondary">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          {/* Dashboard Preview */}
          <motion.div
            className="relative"
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
          >
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 md:p-8 shadow-[0_8px_32px_rgba(0,0,0,0.12),0_32px_64px_rgba(0,0,0,0.12)]">
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['Nuevo', 'En Proceso', 'Enviado', 'Entregado'].map((status, i) => (
                  <div key={i} className="space-y-2">
                    <div className={`text-xs font-medium px-2 py-1 rounded-full text-center whitespace-nowrap ${
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
          {/* Reflection glow */}
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-3/4 h-12 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 blur-2xl rounded-full" />
          </motion.div>
        </div>
      </section>

      {/* AI Assistant Section */}
      <AIAssistantSection 
        aiCapabilities={aiCapabilities} 
        onOpenAuth={() => setIsAuthModalOpen(true)} 
      />

      <div className="section-divider" />

      {/* Testimonials */}
      <section className="py-16 lg:py-20 px-4 sm:px-6 lg:px-8 bg-[#0c0b14]">
        <div className="max-w-7xl mx-auto">
          <motion.div
            className="text-center mb-12"
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
          >
            <h2 className="landing-h2 text-white mb-4">
              Lo que dicen nuestros clientes
            </h2>
            <p className="text-xl text-gray-400">
              Negocios reales con resultados reales
            </p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
          >
            {testimonials.map((testimonial, index) => (
              <motion.div key={index} variants={fadeUp}>
              <Card className="border border-white/10 hover:border-white/15 transition-all duration-300 bg-white/5 h-full overflow-hidden relative">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/40 to-purple-500/40" />
                <CardContent className="pt-8 relative">
                  <span className="absolute top-3 left-5 text-6xl font-serif text-purple-500/10 leading-none select-none">&ldquo;</span>
                  <div className="flex items-center mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="h-4 w-4 text-yellow-400 fill-current" />
                    ))}
                  </div>
                  <p className="text-gray-300 mb-6 relative z-10">&ldquo;{testimonial.content}&rdquo;</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                      {testimonial.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-white">{testimonial.name}</p>
                      <p className="text-sm text-gray-400">{testimonial.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 lg:py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-[#0f0b1a] via-[#131025] to-[#0d0f1a] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-purple-600/5 to-pink-600/5 pointer-events-none" />
        <div className="max-w-5xl mx-auto relative z-10">
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
          >
            {[
              { value: '10k+', label: 'Órdenes procesadas' },
              { value: '500+', label: 'Negocios activos' },
              { value: '99.9%', label: 'Uptime garantizado' },
              { value: '<2s', label: 'Tiempo de respuesta' },
            ].map((stat, i) => (
              <motion.div key={i} variants={fadeUp}>
                <div className="text-4xl md:text-5xl font-extrabold text-white mb-2 tracking-tight">{stat.value}</div>
                <div className="text-gray-400 text-sm">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <div className="section-divider" />

      {/* Pricing */}
      <section id="pricing" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-background">
        <SimplePricingSection />
      </section>

      <div className="section-divider" />

      {/* Contact */}
      <section id="contact" className="py-16 lg:py-20 px-4 sm:px-6 lg:px-8 bg-[#0c0b14]">
        <motion.div
          className="max-w-4xl mx-auto text-center"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
        >
          <h2 className="landing-h2 text-white mb-4">
            ¿Preguntas?
          </h2>
          <p className="text-gray-400 text-lg mb-12">
            Estamos aquí para ayudarte
          </p>
          
          <motion.div
            className="grid md:grid-cols-3 gap-6"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
          >
            <a 
              href="https://wa.me/50661498470"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/[0.08] hover:border-green-500/30 transition-all duration-300"
            >
              <div className="w-14 h-14 mx-auto bg-green-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Phone className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="font-semibold text-white mb-1">WhatsApp</h3>
              <p className="text-gray-400 text-sm">+506 6149-8470</p>
            </a>
            
            <a 
              href="mailto:betsycrm.cr@gmail.com"
              className="group bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/[0.08] hover:border-blue-500/30 transition-all duration-300"
            >
              <div className="w-14 h-14 mx-auto bg-blue-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Mail className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="font-semibold text-white mb-1">Email</h3>
              <p className="text-gray-400 text-sm">betsycrm.cr@gmail.com</p>
            </a>
            
            <a 
              href="https://www.instagram.com/betsy_crm/"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/[0.08] hover:border-pink-500/30 transition-all duration-300"
            >
              <div className="w-14 h-14 mx-auto bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Instagram className="w-6 h-6 text-pink-400" />
              </div>
              <h3 className="font-semibold text-white mb-1">Instagram</h3>
              <p className="text-gray-400 text-sm">@betsy_crm</p>
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="py-24 lg:py-32 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-[#0f0b1a] via-[#131025] to-[#0d0f1a] relative overflow-hidden grain">
        {/* Decorative orb */}
        <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] rounded-full bg-blue-600/15 blur-3xl animate-breathe pointer-events-none" />
        <div className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

        <motion.div
          className="max-w-3xl mx-auto text-center relative z-10"
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
        >
          <h2 className="landing-h2 text-white mb-4">
            Empieza a vender más hoy
          </h2>
          <p className="text-gray-400 text-lg mb-10 max-w-xl mx-auto">
            Únete a cientos de negocios que ya usan Betsy para crecer
          </p>
          <Button 
            size="lg"
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-lg px-10 h-14 rounded-2xl font-semibold hover:-translate-y-0.5 shadow-[0_0_40px_rgba(124,58,237,0.2)] hover:shadow-[0_0_50px_rgba(124,58,237,0.35)] transition-all duration-300"
            onClick={() => setIsAuthModalOpen(true)}
          >
            Crear Cuenta Gratis
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1A1917] text-white relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Main Footer */}
          <div className="py-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
            {/* Brand */}
            <div className="lg:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Betsy</span>
              </div>
              <p className="text-gray-400 text-sm mb-6">
                La plataforma de gestión de pedidos más simple para tu negocio. Con AI Assistant en Telegram y WhatsApp.
              </p>
              <div className="flex gap-3">
                <a 
                  href="https://t.me/BetsyCRMBot" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 hover:bg-[#0088cc] rounded-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
                  title="Telegram"
                >
                  <TelegramIcon />
                </a>
                <a 
                  href="https://wa.me/50661498470" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 hover:bg-[#25D366] rounded-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
                  title="WhatsApp"
                >
                  <WhatsAppIcon />
                </a>
                <a 
                  href="https://www.instagram.com/betsy_crm/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-10 h-10 bg-gray-800 hover:bg-gradient-to-br hover:from-purple-600 hover:to-pink-600 rounded-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
                  title="Instagram"
                >
                  <Instagram className="w-5 h-5" />
                </a>
                <a 
                  href="mailto:betsycrm.cr@gmail.com"
                  className="w-10 h-10 bg-gray-800 hover:bg-blue-600 rounded-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
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
          <div className="border-t border-gray-800/60 py-6">
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
