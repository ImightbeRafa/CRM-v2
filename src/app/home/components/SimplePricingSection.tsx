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
    <section id="pricing" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-background">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="landing-h2 text-foreground mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-xl text-text-secondary max-w-3xl mx-auto">
            Choose the plan that fits your business. All plans include our core features.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto items-start">
          {pricingPlans.map((plan, index) => (
            <div key={index} className={`relative ${plan.popular ? 'mt-0 pt-4' : ''}`}>
              {plan.popular && (
                <div className="absolute -top-0 left-1/2 transform -translate-x-1/2 z-10">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide uppercase bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                    </span>
                    Most Popular
                  </span>
                </div>
              )}
              <Card className={`relative overflow-hidden shadow-elevated hover:shadow-elevated-hover transition-all duration-300 ${plan.popular ? 'border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.15)]' : 'border-gray-200'}`}>
              {plan.popular && (
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-purple-500" />
              )}
              <CardHeader className="text-center">
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                  <span className="text-text-secondary">{plan.period}</span>
                </div>
                {plan.originalPrice && (
                  <p className="text-sm text-text-secondary mt-1">{plan.originalPrice}</p>
                )}
                <CardDescription className="mt-2">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-center">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3 flex-shrink-0" />
                      <span className="text-foreground/80">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  className={`w-full mt-6 h-12 rounded-xl transition-all duration-300 ${plan.popular ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 shadow-[0_0_20px_rgba(124,58,237,0.2)] hover:shadow-[0_0_30px_rgba(124,58,237,0.3)] hover:-translate-y-0.5' : ''}`}
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
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-text-secondary mb-4">
            Prueba gratis por 7 días. Cancela en cualquier momento.
          </p>
          <p className="text-sm text-text-secondary/70 mb-4">
            💳 We accept all major credit cards via secure Tilopay payment processing
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button variant="outline" className="rounded-xl" onClick={() => window.location.href = '#features'}>
              View All Features
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              Contact Sales
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
