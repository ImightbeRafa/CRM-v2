'use client';

import React, { useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { 
  CheckCircle,
  ArrowRight,
  Home,
  BarChart,
  ShoppingCart,
  Settings
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export function CompletionStep({ markCompleted }: WizardStepProps) {
  const router = useRouter();

  useEffect(() => {
    markCompleted();
    
    // Mark wizard as completed in the database
    fetch('/api/setup/wizard-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }).catch(error => {
      console.error('Error marking wizard as complete:', error);
      // Don't block user flow if this fails
    });
  }, [markCompleted]);

  const nextSteps = [
    {
      icon: ShoppingCart,
      title: 'Crear tu Primer Pedido',
      description: 'Ve a Ventas y crea tu primer pedido',
      action: '/ventas',
      color: 'blue'
    },
    {
      icon: BarChart,
      title: 'Ver Estadísticas',
      description: 'Revisa tus métricas y reportes',
      action: '/estadisticas',
      color: 'purple'
    },
    {
      icon: Settings,
      title: 'Ajustar Configuración',
      description: 'Personaliza más detalles en Config',
      action: '/config',
      color: 'gray'
    }
  ];

  const handleNavigate = (path: string) => {
    router.push(path);
  };

  return (
    <div className="space-y-8 text-center">
      {/* Success Animation */}
      <div className="flex flex-col items-center">
        <div className="relative">
          <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-20"></div>
          <div className="relative p-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full">
            <CheckCircle className="h-16 w-16 text-white" />
          </div>
        </div>
        
        <h2 className="text-4xl font-bold text-gray-900 mt-6 mb-3">
          ¡Configuración Completada!
        </h2>
        <p className="text-xl text-gray-600 max-w-2xl">
          Tu CRM está listo para usar. Ahora puedes empezar a gestionar tus ventas y producción.
        </p>
      </div>

      {/* Summary */}
      <Card className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
        <h3 className="text-lg font-semibold text-green-900 mb-4">
          ✨ Lo que has configurado:
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Información del Negocio</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Campos Personalizados</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Estados de Pedidos</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Inventario</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Clientes Frecuentes</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Productos Frecuentes</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Vendedores</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>Métodos de Envío</span>
          </div>
        </div>
      </Card>

      {/* Next Steps */}
      <div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-4">
          ¿Qué sigue?
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {nextSteps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <Card 
                key={idx} 
                className="p-6 hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => handleNavigate(step.action)}
              >
                <div className={`p-3 bg-${step.color}-100 rounded-lg w-fit mb-4 group-hover:scale-110 transition-transform`}>
                  <Icon className={`h-6 w-6 text-${step.color}-600`} />
                </div>
                <h4 className="font-semibold text-gray-900 mb-2">
                  {step.title}
                </h4>
                <p className="text-sm text-gray-600 mb-4">
                  {step.description}
                </p>
                <div className="flex items-center text-blue-600 text-sm font-medium">
                  Ir ahora
                  <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Main Action */}
      <div className="pt-6">
        <Button 
          size="lg" 
          className="bg-green-600 hover:bg-green-700 text-lg px-8 py-6"
          onClick={() => router.push('/home')}
        >
          <Home className="h-5 w-5 mr-2" />
          Ir al Dashboard
        </Button>
        <p className="text-sm text-gray-600 mt-3">
          Puedes volver a ejecutar este asistente desde Configuración → Asistente de Configuración
        </p>
      </div>
    </div>
  );
}

