'use client';

import React, { useEffect } from 'react';
import { WizardStepProps } from '../SetupWizard';
import { Button } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { 
  Sparkles,
  CheckCircle,
  Zap,
  Shield,
  TrendingUp,
  Users
} from 'lucide-react';

export function WelcomeStep({ onNext, markCompleted, isFirst }: WizardStepProps) {
  // Auto-mark as completed since it's just informational
  useEffect(() => {
    markCompleted();
  }, [markCompleted]);

  const features = [
    {
      icon: Zap,
      title: 'Configuración Rápida',
      description: 'Te guiaremos paso a paso en la configuración completa de tu CRM'
    },
    {
      icon: Shield,
      title: 'Seguro y Aislado',
      description: 'Todos tus datos están completamente aislados por tenant'
    },
    {
      icon: TrendingUp,
      title: 'Listo para Crecer',
      description: 'El sistema está diseñado para escalar con tu negocio'
    },
    {
      icon: Users,
      title: 'Multi-Usuario',
      description: 'Agrega tu equipo y asigna roles y permisos fácilmente'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Message */}
      <div className="text-center py-8">
        <div className="inline-flex p-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mb-4">
          <Sparkles className="h-12 w-12 text-white" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-3">
          ¡Bienvenido a Betsy CRM!
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Este asistente te ayudará a configurar todo lo necesario para empezar a gestionar tus ventas y producción de manera eficiente.
        </p>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {features.map((feature, idx) => {
          const Icon = feature.icon;
          return (
            <Card key={idx} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Icon className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {feature.description}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* What to Expect */}
      <Card className="bg-blue-50 border-blue-200 p-6">
        <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          ¿Qué configuraremos?
        </h3>
        <ul className="space-y-2 text-sm text-blue-800">
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span><strong>Información del Negocio:</strong> Campos personalizados para tu empresa</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span><strong>Campos Personalizados:</strong> Adicionales para tus productos</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span><strong>Estados de Pedidos:</strong> Flujo de trabajo personalizado</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span><strong>Inventario:</strong> Productos y stock</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span><strong>Clientes y Productos Frecuentes:</strong> Catálogos rápidos</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span><strong>Vendedores:</strong> Tu equipo de ventas</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 font-bold">•</span>
            <span><strong>Envíos:</strong> Métodos de entrega</span>
          </li>
        </ul>
      </Card>

      {/* Time Estimate */}
      <div className="text-center text-sm text-gray-600">
        <p>
          ⏱️ Tiempo estimado: <strong>15-20 minutos</strong>
        </p>
        <p className="mt-1">
          Puedes omitir pasos opcionales y volver más tarde si lo prefieres.
        </p>
      </div>
    </div>
  );
}

