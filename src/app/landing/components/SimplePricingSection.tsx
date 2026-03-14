'use client';

import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { CheckCircle, Loader2 } from 'lucide-react';

const pricingPlans = [
  {
    name: "Prueba Gratis",
    price: "$0",
    period: "",
    description: "7 días gratis con acceso completo",
    features: [
      "Acceso completo a todas las funciones",
      "Gestión de pedidos y Kanban",
      "Seguimiento de clientes",
      "Reportes básicos",
      "1 usuario",
      "Soporte por email"
    ],
    cta: "Comenzar Gratis",
    popular: false,
    priceId: null,
    tilopayLink: null
  },
  {
    name: "Pro",
    price: "$20",
    period: "/mes",
    description: "Todo incluido para tu negocio",
    features: [
      "Usuarios ilimitados",
      "Pedidos ilimitados",
      "Integración API",
      "Correos de Costa Rica",
      "Reportes y estadísticas",
      "Campos personalizados",
      "Importar desde Excel",
      "Instagram y WhatsApp",
      "Asistente IA (Telegram)",
      "Soporte prioritario"
    ],
    cta: "Activar Pro",
    popular: true,
    priceId: "pro",
    tilopayLink: "https://tp.cr/l/TkRFME9RPT18MQ=="
  }
];

export default function SimplePricingSection() {
  const [loading, setLoading] = useState<string | null>(null);

  const handlePlanSelect = async (plan: typeof pricingPlans[0]) => {
    if (plan.priceId === null) {
      // Free plan - redirect to sign up page
      window.location.href = '/auth/signin?signup=true&plan=free';
      return;
    }

    // For paid plans, show loading and redirect to Tilopay
    // User can create account after payment or existing users can upgrade
    setLoading(plan.priceId);
    
    // Check if user is logged in
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(session => {
        if (session?.user) {
          // User is logged in, redirect to Tilopay payment
          if (plan.tilopayLink) {
            window.location.href = plan.tilopayLink;
          }
        } else {
          // User not logged in, redirect to sign up with plan param
          // After sign up, they'll be directed to upgrade
          window.location.href = `/auth/signin?signup=true&plan=${plan.priceId}`;
        }
      })
      .catch(() => {
        // If session check fails, redirect to sign up
        window.location.href = `/auth/signin?signup=true&plan=${plan.priceId}`;
      });
  };

  return (
    <section id="pricing" className="py-16 px-4 sm:px-6 lg:px-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Choose the plan that fits your business. All plans include our core features.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {pricingPlans.map((plan, index) => (
            <Card key={index} className={`relative ${plan.popular ? 'border-blue-500 shadow-xl' : 'border-gray-200'}`}>
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-blue-500 text-white">Most Popular</Badge>
                </div>
              )}
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-gray-600">{plan.period}</span>
                </div>
                {plan.originalPrice && (
                  <p className="text-sm text-gray-500 mt-1">{plan.originalPrice}</p>
                )}
                <CardDescription className="mt-2">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  className={`w-full mt-6 ${plan.popular ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                  variant={plan.popular ? 'default' : 'outline'}
                  onClick={() => handlePlanSelect(plan)}
                  disabled={loading === plan.priceId}
                >
                  {loading === plan.priceId ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    plan.cta
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">
            Prueba gratis por 7 días. Cancela en cualquier momento.
          </p>
          <p className="text-sm text-gray-500 mb-4">
            💳 We accept all major credit cards via secure Tilopay payment processing
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="outline" onClick={() => window.location.href = '#features'}>
              View All Features
            </Button>
            <Button variant="outline" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              Contact Sales
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
